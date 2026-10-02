# Root-cause debugging

Iron law: **no fix without a confirmed root cause.** (Adapted from gstack `/investigate`, MIT.)

1. **Collect symptoms.** Exact error, stack trace, the command that fails, expected vs actual.
2. **Reproduce deterministically.** If you cannot reproduce it, gather more evidence; do not guess.
3. **Trace backwards** from the symptom through the call chain to where the state first goes wrong.
4. **Check recent changes:** `git log --oneline -15 -- <files>`; a regression lives in the diff.
5. **Check learnings:** `learn.mjs search --files <files> --query "<error words>"`. A recurring bug in
   the same files is an architectural smell: say so in the handoff.
6. **Match known patterns:**

   | Pattern | Signature | Look at |
   | --- | --- | --- |
   | Race condition | Intermittent, timing-dependent | Shared state, async ordering |
   | Null propagation | TypeError / NoneType / nil | Missing guards on optional values |
   | State corruption | Partial updates, inconsistent data | Transactions, callbacks |
   | Integration failure | Timeout, unexpected response | External calls, contracts |
   | Configuration drift | Works locally, fails elsewhere | Env vars, flags, versions |
   | Stale cache | Old data until cleared | Caches, build output |

7. **One hypothesis at a time.** Write it as a testable claim ("X is null because Y returns early
   when Z"). Confirm with a temporary log or assertion *before* changing code. Remove the probe after.
8. **Fix the cause** with the smallest change, plus a regression test that fails without the fix.
9. **Three strikes:** three wrong hypotheses means the problem is bigger than the card. Block.

When searching the web for an error, strip hostnames, paths, SQL, customer data and secrets;
search the error class and library version only.
