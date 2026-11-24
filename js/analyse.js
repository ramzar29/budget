// Analyse du texte lu sur une facture : total, date et commerce.
import { trouverCommerce } from './calc.js';

const pad = n => String(n).padStart(2, '0');
const MOIS = { jan: 1, fev: 2, feb: 2, mar: 3, avr: 4, apr: 4, mai: 5, may: 5, jun: 6, juin: 6, jul: 7, juil: 7,
  aou: 8, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const sansAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Montants : 12,34 / 12.34 / 1 234,56 / 1,234.56 (les espaces parasites de l'OCR sont tolérés : « 12, 34 »)
const RE_MONTANT = /(?<![\d.,])(\d{1,3}(?:[ ,.]\d{3})*|\d+)\s?[.,]\s?(\d{2})(?![\d])/g;

function montantsDe(ligne) {
  const res = [];
  for (const m of ligne.matchAll(RE_MONTANT)) {
    const entier = m[1].replace(/[ ,.]/g, '');
    const v = Number(entier + '.' + m[2]);
    if (!isNaN(v) && v > 0 && v < 100000) res.push(v);
  }
  return res;
}

const MOTS_TOTAL = /\b(total|grand total|montant|a payer|balance|solde|amount due|net a payer|visa|mastercard|debit|interac|paiement)\b/;
const MOTS_EXCLUS = /(sous[- ]?total|subtotal|s-total|tps|tvq|gst|qst|hst|taxe|tax\b|rabais|economi|epargne|escompte|monnaie|change|remis|points|recu\b)/;

export function trouverTotal(texte) {
  const lignes = sansAccents(texte.toLowerCase()).split(/\n/);
  const candidats = [];
  lignes.forEach((l, i) => {
    if (!MOTS_TOTAL.test(l) || MOTS_EXCLUS.test(l)) return;
    let ms = montantsDe(l);
    if (!ms.length && lignes[i + 1]) ms = montantsDe(lignes[i + 1]); // montant sur la ligne suivante
    const prioritaire = /\btotal\b|a payer|amount due/.test(l);
    for (const v of ms) candidats.push({ v, prioritaire });
  });
  const prio = candidats.filter(c => c.prioritaire);
  if (prio.length) return Math.max(...prio.map(c => c.v));
  if (candidats.length) return Math.max(...candidats.map(c => c.v));
  // À défaut : le plus grand montant de la facture
  const tous = lignes.flatMap(montantsDe);
  return tous.length ? Math.max(...tous) : null;
}

function dateValide(a, m, j, auj) {
  if (a < 100) a += 2000;
  if (m < 1 || m > 12 || j < 1 || j > 31) return null;
  const d = new Date(a, m - 1, j);
  if (d.getMonth() !== m - 1) return null;
  const ecart = (auj - d) / 86400000;
  if (ecart < -2 || ecart > 120) return null; // facture : dans les 4 derniers mois
  return { s: `${a}-${pad(m)}-${pad(j)}`, ecart };
}

export function trouverDate(texte, auj = new Date()) {
  const t = sansAccents(texte.toLowerCase());
  const candidats = [];
  const ajouter = d => { if (d) candidats.push(d); };
  // AAAA-MM-JJ ou AAAA/MM/JJ
  for (const m of t.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) ajouter(dateValide(+m[1], +m[2], +m[3], auj));
  // JJ/MM/AAAA, MM/JJ/AAAA, JJ/MM/AA, AA/MM/JJ, MM/JJ/AA
  for (const m of t.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g)) {
    const [x, y, z] = [+m[1], +m[2], +m[3]];
    ajouter(dateValide(z, y, x, auj));      // JJ/MM/AA(AA) — le plus courant au Québec
    ajouter(dateValide(z, x, y, auj));      // MM/JJ/AA(AA) — terminaux américains
    if (m[3].length === 2) ajouter(dateValide(x, y, z, auj)); // AA/MM/JJ
  }
  // 12 dec 2026 / dec 12, 2026 / 12 decembre 2026
  for (const m of t.matchAll(/\b(\d{1,2})\s*(janv?|fevr?|feb|mars?|avr|apr|mai|may|juin|jun|juil|jul|aout?|aug|sept?|oct|nov|dec)[a-z]*\.?\s*(20\d{2}|\d{2})\b/g)) {
    ajouter(dateValide(+m[3], MOIS[m[2].slice(0, 4)] || MOIS[m[2].slice(0, 3)], +m[1], auj));
  }
  for (const m of t.matchAll(/\b(jan|feb|fev|mar|apr|avr|may|mai|jun|juin|jul|juil|aug|aou|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2}),?\s*(20\d{2})\b/g)) {
    ajouter(dateValide(+m[3], MOIS[m[1].slice(0, 4)] || MOIS[m[1].slice(0, 3)], +m[2], auj));
  }
  if (!candidats.length) return null;
  candidats.sort((a, b) => Math.abs(a.ecart) - Math.abs(b.ecart));
  return candidats[0].s;
}

export function trouverNomCommerce(texte, commerces) {
  const connu = trouverCommerce(commerces, texte);
  if (connu) return connu.nom;
  // Sinon : première ligne « lisible » en haut de la facture
  const lignes = texte.split(/\n/).map(l => l.trim()).filter(Boolean).slice(0, 6);
  for (const l of lignes) {
    const lettres = (l.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    if (lettres >= 3 && lettres / l.length > 0.6 && !/^(bienvenue|welcome|merci|facture|recu|reçu)/i.test(l)) {
      return l.replace(/[^\wÀ-ÿ&'\- ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    }
  }
  return '';
}

export function analyserFacture(texte, commerces, auj = new Date()) {
  return {
    montant: trouverTotal(texte),
    date: trouverDate(texte, auj),
    commerce: trouverNomCommerce(texte, commerces)
  };
}
