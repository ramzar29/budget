// Données de départ : catégories et commerces courants au Québec.
// Elles sont créées avec une date de modification très ancienne : toute modification
// réelle (ajout, suppression) faite dans l'app ou le Sheet gagne toujours sur elles.

export const EPOQUE = '2000-01-01T00:00:00.000Z';

export const ICONES = {
  'Logement': '🏠', 'Services': '⚡', 'Alimentation': '🛒', 'Transport': '🚗',
  'Santé': '💊', 'Personnel': '👕', 'Loisirs': '🎉', 'Maison': '🏡',
  'Finances': '💰', 'Divers': '❓',
  'Salaire': '💵', 'Autres revenus': '🎁', 'Retour et remboursement': '↩️'
};

const DEPENSES = {
  'Logement': ['Hypothèque / loyer', 'Taxes municipales et scolaires', 'Assurance habitation', 'Entretien et réparations'],
  'Services': ['Électricité', 'Internet', 'Cellulaires', 'Abonnements'],
  'Alimentation': ['Épicerie', 'Restaurants', 'Café et collations'],
  'Transport': ['Essence', 'Recharge électrique', 'Entretien auto', 'Assurance auto', 'Immatriculation et permis', 'Stationnement et péages'],
  'Santé': ['Pharmacie', 'Dentiste', 'Optométriste', 'Soins'],
  'Personnel': ['Vêtements', 'Coiffure et soins', 'Cadeaux'],
  'Loisirs': ['Sorties', 'Sports', 'Voyages', 'Hobbies'],
  'Maison': ['Meubles', 'Électroménagers', 'Quincaillerie', 'Articles ménagers'],
  'Finances': ['Épargne (REER / CELI)', 'Frais bancaires', 'Dons'],
  'Divers': ['Autre']
};

const REVENUS = {
  'Salaire': ['Paie'],
  'Autres revenus': ['Allocations', 'Cadeau', 'Autre'],
  'Retour et remboursement': ['Retour', 'Remboursement']
};

// [nom affiché, mots-clés (en minuscules, sans accents), catégorie, sous-catégorie]
const COMMERCES = [
  ['IGA', 'iga', 'Alimentation', 'Épicerie'],
  ['Metro', 'metro', 'Alimentation', 'Épicerie'],
  ['Super C', 'super c', 'Alimentation', 'Épicerie'],
  ['Maxi', 'maxi', 'Alimentation', 'Épicerie'],
  ['Provigo', 'provigo', 'Alimentation', 'Épicerie'],
  ['Adonis', 'adonis', 'Alimentation', 'Épicerie'],
  ['Costco', 'costco', 'Alimentation', 'Épicerie'],
  ['Walmart', 'walmart', 'Alimentation', 'Épicerie'],
  ['Tim Hortons', 'tim hortons|tim horton', 'Alimentation', 'Café et collations'],
  ['Starbucks', 'starbucks', 'Alimentation', 'Café et collations'],
  ['McDonald\'s', 'mcdonald', 'Alimentation', 'Restaurants'],
  ['St-Hubert', 'st-hubert|st hubert|sthubert', 'Alimentation', 'Restaurants'],
  ['Subway', 'subway', 'Alimentation', 'Restaurants'],
  ['SAQ', 'saq', 'Alimentation', 'Épicerie'],
  ['Jean Coutu', 'jean coutu|coutu', 'Santé', 'Pharmacie'],
  ['Pharmaprix', 'pharmaprix|shoppers', 'Santé', 'Pharmacie'],
  ['Uniprix', 'uniprix', 'Santé', 'Pharmacie'],
  ['Familiprix', 'familiprix', 'Santé', 'Pharmacie'],
  ['Brunet', 'brunet', 'Santé', 'Pharmacie'],
  ['Petro-Canada', 'petro-canada|petro canada|petrocanada', 'Transport', 'Essence'],
  ['Ultramar', 'ultramar', 'Transport', 'Essence'],
  ['Esso', 'esso', 'Transport', 'Essence'],
  ['Shell', 'shell', 'Transport', 'Essence'],
  ['Couche-Tard', 'couche-tard|couche tard|circle k', 'Transport', 'Essence'],
  ['Irving', 'irving', 'Transport', 'Essence'],
  ['Circuit électrique', 'circuit electrique', 'Transport', 'Recharge électrique'],
  ['Canadian Tire', 'canadian tire', 'Maison', 'Quincaillerie'],
  ['Rona', 'rona', 'Maison', 'Quincaillerie'],
  ['Home Depot', 'home depot', 'Maison', 'Quincaillerie'],
  ['BMR', 'bmr', 'Maison', 'Quincaillerie'],
  ['Réno-Dépôt', 'reno-depot|reno depot', 'Maison', 'Quincaillerie'],
  ['Dollarama', 'dollarama', 'Maison', 'Articles ménagers'],
  ['IKEA', 'ikea', 'Maison', 'Meubles'],
  ['Structube', 'structube', 'Maison', 'Meubles'],
  ['Brault & Martineau', 'brault', 'Maison', 'Meubles'],
  ['Hydro-Québec', 'hydro-quebec|hydro quebec|hydroquebec', 'Services', 'Électricité'],
  ['Vidéotron', 'videotron', 'Services', 'Internet'],
  ['Bell', 'bell canada|bell mobilite', 'Services', 'Cellulaires'],
  ['Fizz', 'fizz', 'Services', 'Cellulaires'],
  ['Netflix', 'netflix', 'Services', 'Abonnements'],
  ['Winners', 'winners', 'Personnel', 'Vêtements'],
  ['Sports Experts', 'sports experts', 'Loisirs', 'Sports'],
  ['Décathlon', 'decathlon', 'Loisirs', 'Sports'],
  ['Amazon', 'amazon', 'Divers', 'Autre']
];

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function categoriesDeDepart() {
  const lignes = [];
  let ordre = 0;
  for (const [type, groupe] of [['depense', DEPENSES], ['revenu', REVENUS]]) {
    for (const [cat, sous] of Object.entries(groupe)) {
      for (const s of sous) {
        lignes.push({
          id: `cat-${slug(cat)}-${slug(s)}`, type, categorie: cat, sousCategorie: s,
          ordre: ordre++, modifieLe: EPOQUE, supprime: false
        });
      }
    }
  }
  return lignes;
}

export function commercesDeDepart() {
  return COMMERCES.map(([nom, motsCles, categorie, sousCategorie]) => ({
    id: `com-${slug(nom)}`, nom, motsCles, categorie, sousCategorie, utilisations: 0,
    modifieLe: EPOQUE, supprime: false
  }));
}

export { slug };
