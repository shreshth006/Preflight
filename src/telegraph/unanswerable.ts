/**
 * An answer for a question that does not carry the parameter it needs.
 *
 * Returning HTTP 400 for a missing parameter is correct as an API and wrong as
 * a miner. Measured in epoch 292: WALLET_BALANCE_CHECK was asked "What is the
 * current native coin balance of wallet address on the Base chain?" -- a
 * question naming no address at all. We answered 400 and scored zero, as did
 * one other miner; the miner that simply answered took the intent with 0.0019.
 *
 * A refusal that explains itself is worth more than a status code, because the
 * node scores the prose it gets back and a 400 gives it none. Nothing here
 * invents a value: it states what was asked, what is missing, and what the
 * answer would require.
 */
export interface UnanswerableResponse {
  verdict: 'not_found';
  found: false;
  confidence: number;
  reason: string;
  checked_at: string;
  missing: string;
}

export function unanswerable(
  subject: string,
  missing: string,
  requirement: string,
  now = new Date(),
): UnanswerableResponse {
  return {
    verdict: 'not_found',
    found: false,
    confidence: 1,
    missing,
    checked_at: now.toISOString(),
    reason:
      `${subject} cannot be reported because the question does not name ${missing}. ` +
      `${requirement} Without it there is nothing to look up, so no value is returned rather ` +
      `than a guessed one.`,
  };
}
