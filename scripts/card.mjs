#!/usr/bin/env node
// card.mjs: manage factory work cards.
//   validate [--json]             validate every card, dependencies and cycles
//   list [--status s]             one line per card
//   order                         dependency order
//   ready                         cards whose dependencies are done
//   new --spec S-001 --title ...  scaffold the next card (status draft)
//   set <id> <status>             change a card's status
import { factoryRoot, parseArgs, die } from './lib/common.mjs';
import { loadCards, saveCard, validateCard, topoOrder, readyCards, nextCardId, STATUSES } from './lib/cards.mjs';

const args = parseArgs();
const [cmd, ...rest] = args._;
const root = factoryRoot();
const cards = loadCards(root);

switch (cmd) {
  case 'validate': {
    const problems = {};
    for (const c of cards) { const p = validateCard(c, cards); if (p.length) problems[c.id] = p; }
    let cycle = null;
    try { topoOrder(cards); } catch (e) { cycle = e.message; }
    if (args.json) { console.log(JSON.stringify({ ok: !Object.keys(problems).length && !cycle, problems, cycle }, null, 2)); }
    else {
      for (const [id, p] of Object.entries(problems)) { console.error(`${id}:`); for (const x of p) console.error(`  - ${x}`); }
      if (cycle) console.error(cycle);
      if (!Object.keys(problems).length && !cycle) console.log(`${cards.length} card(s) valid`);
    }
    process.exit(Object.keys(problems).length || cycle ? 1 : 0);
  }
  case 'list': {
    for (const c of cards.filter((c) => !args.status || c.status === args.status)) {
      console.log(`${c.id}  ${c.status.padEnd(8)} ${c.size.padEnd(2)} ${c.risk.padEnd(6)} deps:[${c.dependsOn.join(',')}]  ${c.title}`);
    }
    break;
  }
  case 'order': console.log(topoOrder(cards).join('\n')); break;
  case 'ready': for (const c of readyCards(cards)) console.log(c.id); break;
  case 'new': {
    if (!args.spec || !args.title) die('usage: card.mjs new --spec S-001 --title "..."');
    const card = {
      id: nextCardId(root), spec: args.spec, title: args.title,
      description: args.description || '(Describe what this card accomplishes and why.)',
      acceptance: [], verification: { commands: [], manual: [], qaSurface: 'none' },
      dependsOn: [], files: { allow: [] }, size: 'S', risk: 'low', highRiskReasons: [],
      rollback: 'git revert the card commits', status: 'draft',
    };
    saveCard(root, card);
    console.log(card.id);
    break;
  }
  case 'set': {
    const [id, status] = rest;
    if (!STATUSES.includes(status)) die(`status must be one of ${STATUSES.join(', ')}`);
    const card = cards.find((c) => c.id === id) || die(`no card ${id}`);
    card.status = status;
    saveCard(root, card);
    console.log(`${id} -> ${status}`);
    break;
  }
  default:
    die('usage: card.mjs <validate|list|order|ready|new|set> ...');
}
