// The one file read for the rules (D-7). Lives beside the engine, not in it: the engine takes a Rules value.
// Refuses a file whose sha256 is not the D-23 hash, so no Settlement row can ever carry an unrecorded one.
import { readFileSync } from 'node:fs';
import { RULES_V1_HASH, RulesError, hashRules, parseRules, type Rules } from '@/auction/engine/rules';

export const RULES_PATH = 'rules/auction.v1.json';

export function loadRules(path = RULES_PATH): { rules: Rules; hash: string } {
  const bytes = readFileSync(path);
  const hash = hashRules(bytes);
  if (hash !== RULES_V1_HASH) throw new RulesError('hash_mismatch', `${path} sha256 ${hash}, D-23 says ${RULES_V1_HASH}`);
  return { rules: parseRules(bytes.toString('utf8')), hash };
}
