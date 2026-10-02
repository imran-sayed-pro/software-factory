// Work cards: load, validate (no external schema lib), dependency order, readiness.
import fs from 'node:fs';
import path from 'node:path';
import { factoryDir, readJSON, writeJSON, globsOverlap } from './common.mjs';

export const SIZES = ['XS', 'S', 'M', 'L'];
export const RISKS = ['low', 'medium', 'high'];
export const STATUSES = ['draft', 'ready', 'running', 'review', 'blocked', 'done', 'merged', 'archived'];
export const SURFACES = ['none', 'browser', 'api', 'cli', 'ios-simulator', 'ios-device'];
const HIGH_RISK_WORDS = /\b(auth|login|password|permission|role|payment|billing|charge|refund|migration|migrate|drop|delete|purge|secret|token|credential|encrypt|deploy)\b/i;

export const cardsDir = (root) => path.join(factoryDir(root), 'cards');
export const cardPath = (root, id) => path.join(cardsDir(root), `${id}.json`);

export function loadCards(root) {
  const dir = cardsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^C-\d+\.json$/.test(f)).sort()
    .map((f) => readJSON(path.join(dir, f)));
}

export function saveCard(root, card) { writeJSON(cardPath(root, card.id), card); }

/** Returns a list of problems; empty means valid. `all` is used for dependency checks. */
export function validateCard(card, all = []) {
  const p = [];
  const req = ['id', 'spec', 'title', 'description', 'acceptance', 'verification', 'dependsOn', 'files', 'size', 'risk', 'rollback', 'status'];
  for (const k of req) if (card[k] === undefined) p.push(`missing field: ${k}`);
  if (p.length) return p;
  if (!/^C-\d{3,}$/.test(card.id)) p.push('id must look like C-001');
  if (!/^S-\d{3,}$/.test(card.spec)) p.push('spec must look like S-001');
  if (typeof card.title !== 'string' || card.title.length < 5 || card.title.length > 90) p.push('title must be 5-90 characters');
  if (/\band\b/i.test(card.title)) p.push('title contains "and": this is probably two cards (split it)');
  if (typeof card.description !== 'string' || card.description.length < 20) p.push('description must be at least 20 characters');
  if (/^\(Describe what this card/.test(card.description || '')) p.push('description is still the placeholder from `card new`');
  if (!Array.isArray(card.acceptance) || card.acceptance.length < 1) p.push('acceptance needs at least one testable criterion');
  else if (card.acceptance.length > 5) p.push('more than 5 acceptance criteria: split the card');
  if (!card.verification || !Array.isArray(card.verification.commands)) p.push('verification.commands must be a list');
  if (card.verification?.qaSurface && !SURFACES.includes(card.verification.qaSurface)) p.push(`verification.qaSurface must be one of ${SURFACES.join(', ')}`);
  if (!Array.isArray(card.dependsOn)) p.push('dependsOn must be a list');
  if (!card.files || !Array.isArray(card.files.allow) || card.files.allow.length === 0) p.push('files.allow must list at least one path or glob');
  else {
    if (card.files.allow.some((g) => g === '**' || g === '**/*' || g === '*' || g === '.')) p.push('files.allow is the whole repo: scope it to the files this card touches');
    if (card.files.allow.some((g) => /(^|\/)CONSTRAINTS\.md$/.test(g))) p.push('cards may not edit CONSTRAINTS.md: loosening the bar needs its own human-reviewed change');
  }
  if (card.size === 'XL') p.push('size XL is too large: split the card (an agent works best on S and M)');
  else if (!SIZES.includes(card.size)) p.push(`size must be one of ${SIZES.join(', ')}`);
  if (!RISKS.includes(card.risk)) p.push(`risk must be one of ${RISKS.join(', ')}`);
  if (card.risk !== 'high' && HIGH_RISK_WORDS.test(`${card.title} ${card.description}`)) {
    p.push(`mentions a high-risk area (${(`${card.title} ${card.description}`.match(HIGH_RISK_WORDS) || [])[0]}) but risk is "${card.risk}": set risk high or explain in notes`);
  }
  if (card.risk === 'high' && !(card.highRiskReasons?.length)) p.push('high-risk cards must list highRiskReasons');
  if (typeof card.rollback !== 'string' || card.rollback.length < 5) p.push('rollback must say how to undo this card');
  if (!STATUSES.includes(card.status)) p.push(`status must be one of ${STATUSES.join(', ')}`);
  const ids = new Set(all.map((c) => c.id));
  for (const d of card.dependsOn || []) {
    if (d === card.id) p.push('card depends on itself');
    else if (all.length && !ids.has(d)) p.push(`depends on unknown card ${d}`);
  }
  return p;
}

/** Kahn topological sort; throws on a cycle. */
export function topoOrder(cards) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const indeg = new Map(cards.map((c) => [c.id, 0]));
  for (const c of cards) for (const d of c.dependsOn) if (byId.has(d)) indeg.set(c.id, indeg.get(c.id) + 1);
  const queue = cards.filter((c) => indeg.get(c.id) === 0).map((c) => c.id).sort();
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const c of cards) if (c.dependsOn.includes(id)) {
      indeg.set(c.id, indeg.get(c.id) - 1);
      if (indeg.get(c.id) === 0) { queue.push(c.id); queue.sort(); }
    }
  }
  if (order.length !== cards.length) {
    const stuck = cards.filter((c) => !order.includes(c.id)).map((c) => c.id);
    throw new Error(`dependency cycle among: ${stuck.join(', ')}`);
  }
  return order;
}

// A dependency counts only once it is merged: a worker branches from the base branch, so it can
// build on another card's code only after that code is on the base branch.
const DONE_STATES = new Set(['merged']);

/** Cards whose status is ready and every dependency is merged. */
export function readyCards(cards) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return cards.filter((c) => c.status === 'ready' && c.dependsOn.every((d) => DONE_STATES.has(byId.get(d)?.status)));
}

/** Pick cards to start now: ready, under capacity, and no file overlap with running work or each other. */
export function pickLaunchable(cards, capacity) {
  // Unmerged work keeps its files locked: running, in review, and done-but-not-merged.
  const running = cards.filter((c) => ['running', 'review', 'done'].includes(c.status));
  const chosen = [];
  const skipped = [];
  for (const c of readyCards(cards)) {
    if (chosen.length >= capacity) break;
    const clash = [...running, ...chosen].find((r) => globsOverlap(r.files.allow, c.files.allow));
    if (clash) { skipped.push({ id: c.id, reason: `file overlap with ${clash.id}` }); continue; }
    chosen.push(c);
  }
  return { chosen, skipped };
}

export function nextCardId(root) {
  const nums = loadCards(root).map((c) => Number(c.id.slice(2)));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return `C-${String(n).padStart(3, '0')}`;
}
