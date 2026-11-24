// Photo d'une facture -> lecture du texte (Tesseract.js, gratuit, sur le téléphone) -> formulaire prérempli.
// La photo n'est jamais conservée : elle reste en mémoire le temps de la saisie (miniature), puis est jetée.
import { h, feuille, toast } from './ui.js';
import { ouvrirSaisie } from './saisie.js';
import { E } from './etat.js';
import { analyserFacture } from './analyse.js';

const URL_TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let chargement;

function chargerTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!chargement) {
    chargement = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = URL_TESSERACT;
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { chargement = null; reject(new Error('telechargement')); };
      document.head.append(s);
    });
  }
  return chargement;
}

/** Réduit, met en gris et augmente le contraste : la lecture est plus fiable et plus rapide. */
async function preparerImage(fichier) {
  const bitmap = await createImageBitmap(fichier, { imageOrientation: 'from-image' });
  const max = 1800;
  const echelle = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * echelle);
  canvas.height = Math.round(bitmap.height * echelle);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close && bitmap.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const p = img.data;
  let min = 255, maxL = 0;
  const gris = new Uint8ClampedArray(p.length / 4);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    gris[j] = g;
    if (g < min) min = g;
    if (g > maxL) maxL = g;
  }
  const etendue = Math.max(1, maxL - min);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    const v = Math.min(255, Math.max(0, ((gris[j] - min) / etendue) * 255 * 1.15 - 15));
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Choix : prendre une photo avec l'appareil, ou choisir une image (capture d'écran, photo déjà prise). */
export function ouvrirPhoto() {
  feuille('Photo d\'une facture', (corps, fermer) => {
    corps.append(
      h('div', { class: 'grille-choix deux' },
        h('button', { class: 'choix', onclick: () => { choisirFichier(true); fermer(); } }, h('span', { class: 'gros' }, '📷'), 'Prendre une photo'),
        h('button', { class: 'choix', onclick: () => { choisirFichier(false); fermer(); } }, h('span', { class: 'gros' }, '🖼️'), 'Choisir une image')),
      h('p', { class: 'rappel-rouge' }, '⚠️ Les PDF ne sont pas acceptés : seulement une capture d\'écran ou une image (JPG, PNG…).'));
  });
}

function choisirFichier(camera) {
  // Le clic sur le champ fichier doit se faire pendant le geste de l'utilisateur.
  const entree = h('input', { type: 'file', accept: 'image/*', capture: camera ? 'environment' : null, style: { display: 'none' } });
  document.body.append(entree);
  entree.addEventListener('change', () => {
    const fichier = entree.files && entree.files[0];
    entree.remove();
    if (!fichier) return;
    if (!fichier.type.startsWith('image/')) {
      return toast(fichier.type === 'application/pdf' ? 'PDF refusé : fais une capture d\'écran de la facture.' : 'Ce fichier n\'est pas une image.', 'erreur');
    }
    lire(fichier);
  });
  entree.click();
}

async function lire(fichier) {
  // Aperçu en mémoire seulement (jamais enregistré) ; libéré à la fermeture du formulaire.
  const image = URL.createObjectURL(fichier);
  let fermerAttente;
  const statut = h('p', { class: 'aide centre' }, 'Préparation de l\'image…');
  const barre = h('div', { class: 'barre' }, h('span', { style: { width: '5%', background: 'var(--accent)' } }));
  feuille('Lecture de la facture', (corps, fermer) => {
    fermerAttente = fermer;
    corps.append(h('div', { class: 'lecture' }, h('div', { class: 'logo' }, '🔎'), statut, barre,
      h('p', { class: 'aide centre' }, 'La première fois, l\'app télécharge le module de lecture (environ 10 Mo). Ensuite, c\'est plus rapide.')));
  });
  const progres = (txt, pct) => { statut.textContent = txt; barre.firstChild.style.width = Math.round(pct) + '%'; };

  let worker;
  try {
    const canvas = await preparerImage(fichier);
    progres('Chargement du module de lecture…', 10);
    const Tesseract = await chargerTesseract();
    worker = await Tesseract.createWorker(['fra', 'eng'], 1, {
      logger: m => {
        if (m.status === 'recognizing text') progres('Lecture du texte…', 30 + m.progress * 70);
        else if (m.status && m.status.includes('loading')) progres('Chargement du module de lecture…', 10 + (m.progress || 0) * 20);
      }
    });
    const { data } = await worker.recognize(canvas);
    canvas.width = canvas.height = 0; // libère l'image
    const resultat = analyserFacture(data.text || '', E.commerces);
    fermerAttente();
    const trouves = [resultat.montant && 'montant', resultat.date && 'date', resultat.commerce && 'commerce'].filter(Boolean);
    toast(trouves.length ? `Lu : ${trouves.join(', ')}. Vérifie avant d'enregistrer.` : 'Rien de lisible — entre les valeurs à la main.', trouves.length ? 'info' : 'erreur');
    ouvrirSaisie({
      type: 'depense', source: 'photo',
      prerempli: { montant: resultat.montant, date: resultat.date, commerce: resultat.commerce, lu: true, texte: data.text, image }
    });
  } catch (e) {
    console.warn('ocr', e);
    fermerAttente && fermerAttente();
    toast(e.message === 'telechargement' ? 'Module de lecture indisponible (pas de réseau ?). Saisie manuelle.' : 'Lecture impossible. Saisie manuelle.', 'erreur');
    ouvrirSaisie({ type: 'depense', source: 'manuelle', prerempli: { image } });
  } finally {
    if (worker) worker.terminate().catch(() => {});
  }
}
