// Stockage local (IndexedDB). Les tables reflètent les onglets du Google Sheets.
// Chaque enregistrement porte : id, modifieLe (ISO), supprime (bool), _sale (à envoyer).

export const TABLES = ['Transactions', 'Categories', 'Commerces', 'DepensesFixes', 'Revenus', 'Reglages'];

let dbPromise;
const ecouteurs = new Set();

function ouvrir() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('budget', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const t of TABLES) db.createObjectStore(t, { keyPath: 'id' });
      db.createObjectStore('meta'); // réglages propres à ce téléphone (jamais synchronisés)
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return ouvrir().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let resultat;
    Promise.resolve(fn(s)).then(r => { resultat = r; });
    t.oncomplete = () => resolve(resultat);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

/** Tous les enregistrements non supprimés (ou tous si inclureSupprimes). */
export async function tous(table, inclureSupprimes = false) {
  const liste = await tx(table, 'readonly', s => req(s.getAll()));
  return inclureSupprimes ? liste : liste.filter(r => !r.supprime);
}

export function lire(table, id) {
  return tx(table, 'readonly', s => req(s.get(id)));
}

export function maintenant() {
  return new Date().toISOString();
}

/** Enregistre une modification locale (marquée à envoyer au Sheet). */
export async function sauver(table, enregistrements) {
  const liste = Array.isArray(enregistrements) ? enregistrements : [enregistrements];
  const quand = maintenant();
  await tx(table, 'readwrite', s => {
    for (const r of liste) s.put({ supprime: false, ...r, modifieLe: quand, _sale: true });
  });
  notifier(table);
}

/** Supprime (logiquement) : la ligne reste avec supprime = vrai pour que la synchro la propage. */
export async function supprimer(table, ids) {
  const liste = Array.isArray(ids) ? ids : [ids];
  const quand = maintenant();
  await tx(table, 'readwrite', async s => {
    for (const id of liste) {
      const r = await req(s.get(id));
      if (r) s.put({ ...r, supprime: true, modifieLe: quand, _sale: true });
    }
  });
  notifier(table);
}

/** Écriture brute (utilisée par la synchro et l'initialisation). */
export async function ecrireBrut(table, enregistrements) {
  if (!enregistrements.length) return;
  await tx(table, 'readwrite', s => { for (const r of enregistrements) s.put(r); });
  notifier(table);
}

export async function nbASynchroniser() {
  let n = 0;
  for (const t of TABLES) n += (await tous(t, true)).filter(r => r._sale).length;
  return n;
}

// --- méta (local au téléphone)
export function getMeta(cle) {
  return tx('meta', 'readonly', s => req(s.get(cle)));
}
export async function setMeta(cle, valeur) {
  await tx('meta', 'readwrite', s => { s.put(valeur, cle); });
}

// --- avis de changement (pour rafraîchir l'écran)
export function surChangement(fn) { ecouteurs.add(fn); return () => ecouteurs.delete(fn); }
let attente;
function notifier(table) {
  clearTimeout(attente);
  attente = setTimeout(() => ecouteurs.forEach(fn => fn(table)), 30);
}

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      });
}
