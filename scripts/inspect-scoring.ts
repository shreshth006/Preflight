import { readFile } from 'node:fs/promises';

process.stdout.on('error', (error) => {
  if ((error as NodeJS.ErrnoException).code === 'EPIPE') process.exit(0);
  throw error;
});

interface Epoch {
  epoch_id: number;
}

interface Score {
  epoch_id: number;
  intent_id: string;
  miner_slug: string;
  rank: number;
  score: number;
  question: string;
  ground_truth: string;
  miner_answer: string;
  converted_answer: string;
  failure_reason: string;
  scored_at: string;
}

interface Registration {
  miner: {
    registration_id: number;
    slug: string;
    activation_status: string;
    supported_intents: string[];
  };
}

const explorerUrl = (
  process.env.TELEGRAPH_EXPLORER_URL ?? 'https://explorer.telegraphprotocol.com'
).replace(/\/$/, '');
const nodeUrl = (process.env.TELEGRAPH_NODE_URL ?? 'https://devnode.telegraphprotocol.com').replace(
  /\/$/,
  '',
);
const jsonOutput = process.argv.includes('--json');

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

const registrationId =
  argument('registration') ??
  process.env.REGISTRATION_ID ??
  (await readFile(new URL('../telegraph/registration-id', import.meta.url), 'utf8')).trim();
const registration = await fetchJson<Registration>(`${nodeUrl}/api/miners/${registrationId}`);
const epochArgument = argument('epoch');
const epoch = epochArgument
  ? Number.parseInt(epochArgument, 10)
  : (await fetchJson<{ epochs: Epoch[] }>(`${explorerUrl}/api/epochs`)).epochs[0]?.epoch_id;

if (!epoch || !Number.isSafeInteger(epoch))
  throw new Error(`invalid epoch: ${epochArgument ?? 'latest'}`);

const minerSlug = argument('miner') ?? registration.miner.slug;
const requestedIntent = argument('intent');
const intents = requestedIntent ? [requestedIntent] : registration.miner.supported_intents;

const receipts = await Promise.all(
  intents.map(async (intent) => {
    const url = `${explorerUrl}/api/scores?epoch=${epoch}&intent=${encodeURIComponent(intent)}`;
    const { scores } = await fetchJson<{ scores: Score[] }>(url);
    const leaderboard = [...scores]
      .sort(
        (left, right) => left.rank - right.rank || left.miner_slug.localeCompare(right.miner_slug),
      )
      .map((score) => ({
        miner: score.miner_slug,
        rank: score.rank,
        score: score.score,
        convertedAnswer: score.converted_answer,
        minerAnswer: score.miner_answer,
        failureReason: score.failure_reason,
        scoredAt: score.scored_at,
      }));
    const mine = scores.find((score) => score.miner_slug === minerSlug);
    const leader = scores.find((score) => score.rank === 1) ?? scores[0];

    return {
      intent,
      question: scores[0]?.question ?? null,
      groundTruth: scores[0]?.ground_truth ?? null,
      leader: leader ? { miner: leader.miner_slug, rank: leader.rank, score: leader.score } : null,
      miner: mine
        ? {
            rank: mine.rank,
            score: mine.score,
            normalizedToLeader:
              leader && leader.score > 0 ? Number((mine.score / leader.score).toFixed(8)) : null,
            convertedAnswer: mine.converted_answer,
            minerAnswer: mine.miner_answer,
            failureReason: mine.failure_reason,
            scoredAt: mine.scored_at,
          }
        : null,
      leaderboard,
    };
  }),
);

const report = {
  capturedAt: new Date().toISOString(),
  epoch,
  registrationId: registration.miner.registration_id,
  activationStatus: registration.miner.activation_status,
  miner: minerSlug,
  intents: receipts,
};

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    `PREFLIGHT Telegraph score snapshot\nEpoch: ${epoch}\nMiner: ${minerSlug}\nRegistration: ${registrationId} (${registration.miner.activation_status})\n`,
  );
  for (const receipt of receipts) {
    const mine = receipt.miner;
    process.stdout.write(
      `\n${receipt.intent}\n  score: ${mine?.score ?? 'not scored'}\n  rank: ${mine?.rank ?? '-'}\n  leader: ${receipt.leader ? `${receipt.leader.miner} (${receipt.leader.score})` : '-'}\n  normalized: ${mine?.normalizedToLeader ?? '-'}\n  question: ${receipt.question ?? '-'}\n  converted answer: ${mine?.convertedAnswer || '-'}\n`,
    );
  }
}
