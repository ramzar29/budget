// Synchronisation avec le Google Sheets (via l'Apps Script déployé en application Web).
import { TABLES, tous, ecrireBrut, getMeta, setMeta, nbASynchroniser } from './db.js';

const etat = { enCours: false, derniere: null, erreur: null, enAttente: 0 };
const ecouteurs = new Set();
export const surEtatSync = fn => { ecouteurs.add(fn); fn(etat); return () => ecouteurs.delete(fn); };
const diffuser = () => ecouteurs.forEach(fn => fn(etat));

async function appeler(corps) {
  const url = await getMeta('apiUrl');
  const jeton = await getMeta('jeton');
  if (!url || !jeton) throw new Error('non-configure');
  const rep = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ jeton, ...corps }),
    redirect: 'follow'
  });
  if (!rep.ok) throw new Error('HTTP ' + rep.status);
  const json = await rep.json();
  if (!json.ok) throw new Error(json.erreur || 'erreur-serveur');
  return json;
}

/** Vérifie l'adresse et le jeton (bouton « Tester » des réglages). */
export async function tester(url, jeton) {
  const rep = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ jeton, action: 'ping' }), redirect: 'follow'
  });
  const json = await rep.json();
  if (!json.ok) throw new Error(json.erreur || 'erreur');
  return json;
}

function nettoyer(r) {
  const o = {};
  for (const [k, v] of Object.entries(r)) if (!k.startsWith('_')) o[k] = v;
  return o;
}

let relance = null;
export async function synchroniser() {
  if (etat.enCours) { relance = true; return; }
  if (!navigator.onLine) { etat.enAttente = await nbASynchroniser(); diffuser(); return; }
  etat.enCours = true; etat.erreur = null; diffuser();
  try {
    const depuis = (await getMeta('derniereSync')) || '';
    const envoyes = {};
    const changements = {};
    for (const t of TABLES) {
      const sales = (await tous(t, true)).filter(r => r._sale);
      envoyes[t] = sales;
      changements[t] = sales.map(nettoyer);
    }
    const rep = await appeler({ action: 'sync', depuis, changements });

    for (const t of TABLES) {
      const locaux = new Map((await tous(t, true)).map(r => [r.id, r]));
      const aEcrire = [];
      // Ce qu'on a envoyé n'est plus « à envoyer », sauf si modifié pendant l'envoi.
      for (const r of envoyes[t]) {
        const actuel = locaux.get(r.id);
        if (actuel && actuel._sale && actuel.modifieLe === r.modifieLe) {
          const propre = { ...actuel, _sale: false };
          locaux.set(r.id, propre);
          aEcrire.push(propre);
        }
      }
      // Ce qui vient du Sheet : la modification la plus récente gagne.
      for (const distant of rep.changements[t] || []) {
        if (!distant.id) continue;
        const local = locaux.get(distant.id);
        if (local && local._sale && (local.modifieLe || '') > (distant.modifieLe || '')) continue;
        // On part du local : une colonne absente du Sheet (script pas encore à jour) n'efface rien.
        const rec = { ...(local || {}), ...distant, supprime: distant.supprime === true, _sale: false };
        if (t === 'Transactions' && rec.date && !rec.mois) rec.mois = String(rec.date).slice(0, 7);
        aEcrire.push(rec);
      }
      await ecrireBrut(t, aEcrire);
    }
    await setMeta('derniereSync', rep.heureServeur);
    await setMeta('derniereSyncLocale', new Date().toISOString());
    etat.derniere = new Date();
  } catch (e) {
    etat.erreur = e.message === 'non-configure' ? 'Synchro non configurée (Réglages)'
      : e.message === 'jeton-invalide' ? 'Jeton secret invalide (Réglages)'
      : 'Échec de la synchro — nouvel essai plus tard';
    console.warn('sync', e);
  } finally {
    etat.enCours = false;
    etat.enAttente = await nbASynchroniser();
    diffuser();
    if (relance) { relance = null; setTimeout(synchroniser, 500); }
  }
}

let minuterie;
/** Demande une synchro bientôt (regroupe plusieurs saisies rapprochées). */
export function synchroniserBientot(delai = 1500) {
  clearTimeout(minuterie);
  minuterie = setTimeout(synchroniser, delai);
}

export async function demarrerSyncAuto() {
  etat.derniere = (await getMeta('derniereSyncLocale')) ? new Date(await getMeta('derniereSyncLocale')) : null;
  etat.enAttente = await nbASynchroniser();
  diffuser();
  window.addEventListener('online', () => synchroniserBientot(500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') synchroniserBientot(500);
  });
  setInterval(() => { if (document.visibilityState === 'visible') synchroniser(); }, 5 * 60 * 1000);
  synchroniser();
}
