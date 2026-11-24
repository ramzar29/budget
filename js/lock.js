// Verrou de l'app : biométrie du téléphone (WebAuthn) avec NIP de secours.
// C'est un verrou d'accès local : il empêche d'ouvrir l'app sans ton empreinte/visage ou ton NIP.
import { getMeta, setMeta } from './db.js';

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function hacher(nip, sel) {
  const data = new TextEncoder().encode(sel + ':' + nip);
  return b64(await crypto.subtle.digest('SHA-256', data));
}

export async function nipDefini() { return !!(await getMeta('nipHash')); }

export async function definirNip(nip) {
  const sel = b64(crypto.getRandomValues(new Uint8Array(16)));
  await setMeta('nipSel', sel);
  await setMeta('nipHash', await hacher(nip, sel));
}

export async function verifierNip(nip) {
  const sel = await getMeta('nipSel');
  return (await hacher(nip, sel)) === (await getMeta('nipHash'));
}

export async function biometrieDisponible() {
  try {
    return !!window.PublicKeyCredential &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

export async function biometrieActive() { return !!(await getMeta('credId')); }

export async function activerBiometrie(nomUtilisateur) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Budget' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: nomUtilisateur || 'budget', displayName: nomUtilisateur || 'Budget'
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000
    }
  });
  await setMeta('credId', b64(cred.rawId));
}

export async function desactiverBiometrie() { await setMeta('credId', null); }

export async function deverrouillerBiometrie() {
  const id = await getMeta('credId');
  if (!id) return false;
  try {
    const r = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: deB64(id) }],
        userVerification: 'required', timeout: 60000
      }
    });
    return !!r;
  } catch { return false; }
}

// Re-verrouiller après 5 minutes en arrière-plan.
const DELAI = 5 * 60 * 1000;
let cacheLe = null;
export function surveillerArrierePlan(reverrouiller) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cacheLe = Date.now();
    else if (cacheLe && Date.now() - cacheLe > DELAI) { cacheLe = null; reverrouiller(); }
  });
}
