/* ═══════════════════════════════════════════════════════════
   OpenWire — Anonymous Persistent Identity Layer
   Keyed by device UUID (stable across nick changes).
   Stores profile in localStorage with IndexedDB backup.
   All date comparisons use IST (UTC+5:30) calendar days.
   ═══════════════════════════════════════════════════════════ */

const DEVICE_KEY = 'openwire_device_id';
const PROFILE_PREFIX = 'openwire:profile:';
const IDB_DB_NAME = 'openwire-profiles';
const IDB_STORE = 'profiles';

/* ── 256-word wordlist for deterministic passphrase ───────── */
const WORDLIST = [
    'apple','arrow','atlas','azure','bacon','badge','beach','beard',
    'bench','berry','birch','blade','blaze','blend','block','bloom',
    'blues','blunt','board','bones','bonus','boost','brave','bread',
    'bream','brew','brick','bride','brief','brine','brisk','brood',
    'brook','brush','brute','budge','build','bulge','bunch','burst',
    'cabin','camel','canoe','cargo','cedar','chalk','charm','chart',
    'chase','chest','chief','chill','chord','claim','clamp','clash',
    'class','clean','clerk','cliff','climb','clink','clone','cloud',
    'clown','coach','coast','cobra','cocoa','comet','coral','couch',
    'could','count','court','craft','crank','crash','crave','cream',
    'creek','crisp','croft','cross','crowd','crown','cruel','crush',
    'crux','cubic','curve','daisy','dance','dandy','denim','depot',
    'derby','digit','diode','disco','ditch','diver','dodge','dogma',
    'dome','doubt','dough','draft','drain','drake','drama','drawl',
    'dream','drill','drift','drive','droop','drops','drove','drum',
    'dunes','dunno','dusk','eagle','earth','eight','elect','ember',
    'enact','epoch','equal','essay','evade','event','exact','excel',
    'exile','extra','fable','facet','fairy','false','fancy','farce',
    'feast','feral','fetch','fever','fibre','field','fifth','fifty',
    'fight','fjord','flame','flank','flare','flash','flask','flat',
    'flesh','flick','flock','flood','flora','floss','flour','fluke',
    'flute','focal','folio','forge','forth','forum','frail','frame',
    'franc','fraud','fresh','front','frost','froze','fruit','fungi',
    'funky','gamma','ghost','glade','glare','glass','gleam','glide',
    'gloom','gloss','glove','glyph','gnome','grace','grade','graft',
    'grain','grant','grape','grasp','grass','grave','graze','greed',
    'green','greet','grime','grind','gripe','groan','grope','grove',
    'growl','grown','gruel','gruff','guild','guile','guise','gusto',
    'havoc','hazel','helix','herbs','heron','hoist','honey','honor',
    'horse','hostel','hotel','hound','hunch','hydra','hyena','iamb',
    'image','index','indie','infer','ingot','inkwell','input','inter',
    'intro','ionic','ivory','jaunt','jewel','judge','juice','jumbo',
    'karma','kayak','kelp','knack','knife','knoll','krill','kudos',
    'lance','larch','latch','latte','layer','leech','lemon','level',
    'light','linen','liver','llama','lobby','lodge','lofty','logic',
    'lotus','lunar','lusty','lymph','lyric','magic','mango','maple',
    'march','marsh','masks','match','manor','metal','might','mirth',
    'mixed','mocha','modal','moose','mossy','motif','mount','mouse',
    'mouth','mulch','mural','nadir','navel','nerve','night','noble',
    'north','notch','novel','nymph','oaken','ocean','olive','onion',
    'optic','orbit','orcas','order','other','otter','outer','oxide',
    'ozone','paddy','panel','panic','pants','paper','patch','pause',
    'peace','peach','pearl','pedal','penny','perch','piano','pilot',
    'pinch','pixel','pizza','place','plain','plank','plant','plate',
    'plaza','plume','plunk','plush','poem','point','poker','polar',
    'poppy','porch','posed','pouch','power','press','price','prick',
    'prime','prism','privy','probe','prone','prune','pulse','punch',
    'pupil','purge','quest','queue','quota','quoth','radar','radix',
    'rally','ramen','ranch','range','rapid','raven','reach','realm',
    'rebel','recap','recon','reign','relax','relay','realm','remix',
    'renew','repay','rerun','reset','ridge','risky','rival','rivet',
    'rogue','rolly','roost','rough','round','rowdy','royal','rugby',
    'ruler','rusty','sadly','saint','salad','salsa','sandy','sauce',
    'seven','shaft','shake','shale','shame','shark','sharp','sheen',
    'shelf','shell','shift','shine','shire','shore','short','shout',
    'siege','sigma','silex','silly','since','sixth','sixty','skate',
    'skied','skimp','skull','slant','sleet','slept','slice','slide',
    'sloth','smart','smear','smelt','smoke','snail','snake','snare',
    'sneak','solve','sorry','south','spark','spear','spell','spire',
    'splat','sport','spout','spray','spree','sprig','squad','squid',
    'stack','staff','stain','stale','stare','stark','start','stave',
    'steel','steep','steer','stern','stiff','still','stock','stomp',
    'stone','storm','story','stout','straw','stray','strap','strip',
    'stump','swamp','swarm','swear','swept','swift','sword','synth',
    'tabby','talon','taupe','tense','terra','theft','third','thorn',
    'those','three','threw','thrift','thumb','thyme','tidal','tiger',
    'tiled','titan','today','token','tonic','topaz','torch','total',
    'trace','track','trade','trail','train','tramp','trawl','trend',
    'triad','tribe','trick','trout','trove','truck','trust','truth',
    'tulip','tuner','turbo','tutor','tweed','twice','twine','twist',
    'ultra','umbra','unbox','uncle','uncut','under','uneasy','union',
    'unity','until','upper','upset','urban','usage','usual','utter',
    'vapor','vault','vegan','vigor','viral','vivid','vixen','vocal',
    'vodka','voice','voter','vowed','vying','waltz','waste','watch',
    'water','weave','wedge','weigh','whale','wheat','whirl','white',
    'whole','wield','witch','withe','witty','woman','world','wormy',
    'worst','worth','wraith','wrath','write','wrong','yacht','yearn',
    'yeast','yield','young','youth','zesty','zingy','zippy','zones',
];

/* ── IST date helper ──────────────────────────────────────── */
function getISTDateString() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

/* ── Stable hash: string → non-negative integer ───────────── */
function stableHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0; // unsigned 32-bit
}

/* ── Device fingerprint ───────────────────────────────────── */
export function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
        id = crypto.randomUUID?.()
            ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
}

/* ── Storage key helpers ──────────────────────────────────── */
export function getProfileKey(deviceId) {
    return `${PROFILE_PREFIX}${deviceId}`;
}

/* ── IndexedDB helpers ────────────────────────────────────── */
function openIDB() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { resolve(null); return; }
        try {
            const req = indexedDB.open(IDB_DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE, { keyPath: 'deviceId' });
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = () => resolve(null); // silently fail
        } catch {
            resolve(null);
        }
    });
}

export async function saveProfileToIndexedDB(profile) {
    try {
        const db = await openIDB();
        if (!db) return;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                const store = tx.objectStore(IDB_STORE);
                const req = store.put(profile);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve(); // silently fail
            } catch {
                resolve();
            }
        });
    } catch {
        // silently fail
    }
}

export async function loadProfileFromIndexedDB(deviceId) {
    try {
        const db = await openIDB();
        if (!db) return null;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(IDB_STORE, 'readonly');
                const store = tx.objectStore(IDB_STORE);
                const req = store.get(deviceId);
                req.onsuccess = (e) => resolve(e.target.result ?? null);
                req.onerror = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
    } catch {
        return null;
    }
}

/* ── Load / create profile ────────────────────────────────── */
export function loadProfile(nick) {
    const deviceId = getDeviceId();
    let profile = null;

    try {
        const raw = localStorage.getItem(getProfileKey(deviceId));
        profile = raw ? JSON.parse(raw) : null;
    } catch {
        profile = null;
    }

    if (!profile) {
        profile = {
            deviceId,
            currentNick: nick ?? 'AnonymousUser',
            chips: 1000,
            reputation: { karma: 0, tier: 'newcomer', history: [] },
            cosmetics: { owned: [], equipped: {} },
            vault: { staked: 0, stakedAt: null },
            streak: { count: 0, lastLogin: null },
            mutedAgents: [],
            transactions: [],
            createdAt: new Date().toISOString(),
        };
    } else if (nick) {
        profile = { ...profile, currentNick: nick };
    }

    saveProfile(profile);
    return profile;
}

/* ── Save profile ─────────────────────────────────────────── */
export function saveProfile(profile) {
    try {
        localStorage.setItem(getProfileKey(profile.deviceId), JSON.stringify(profile));
    } catch (e) {
        console.warn('Failed to save profile', e);
    }
    saveProfileToIndexedDB(profile); // fire-and-forget backup
}

/* ── Streak management ────────────────────────────────────── */
export function updateStreak(profile) {
    const today = getISTDateString();
    const last = profile.streak?.lastLogin;

    if (last === today) {
        // Same day — no change
        return profile;
    }

    let newCount;
    if (!last) {
        newCount = 1;
    } else {
        // Compare calendar days (IST)
        const lastDate = new Date(`${last}T00:00:00+05:30`);
        const todayDate = new Date(`${today}T00:00:00+05:30`);
        const diffDays = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
            newCount = (profile.streak?.count ?? 0) + 1;
        } else {
            // Gap > 1 day — reset
            newCount = 1;
        }
    }

    return {
        ...profile,
        streak: {
            ...profile.streak,
            count: newCount,
            lastLogin: today,
        },
    };
}

/* ── Daily bonus calculation ──────────────────────────────── */
export function calculateDailyBonus(streakCount) {
    return Math.min(50 + (10 * streakCount), 200);
}

/* ── Wipe identity ────────────────────────────────────────── */
export async function wipeIdentity(deviceId) {
    try {
        localStorage.removeItem(DEVICE_KEY);
        localStorage.removeItem(getProfileKey(deviceId));
    } catch {
        // silently fail
    }
    try {
        const db = await openIDB();
        if (!db) return;
        await new Promise((resolve) => {
            try {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                const store = tx.objectStore(IDB_STORE);
                const req = store.delete(deviceId);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            } catch {
                resolve();
            }
        });
    } catch {
        // silently fail
    }
}

/* ── Deterministic passphrase ─────────────────────────────── */
export function exportPassphrase(profile) {
    const id = profile.deviceId;
    const size = WORDLIST.length; // 256

    // Derive 4 words using FNV-1a seeded at different offsets
    const h0 = stableHash(id);
    const h1 = stableHash(id + '\x01');
    const h2 = stableHash(id + '\x02');
    const h3 = stableHash(id + '\x03');

    const w0 = WORDLIST[h0 % size];
    const w1 = WORDLIST[h1 % size];
    const w2 = WORDLIST[h2 % size];
    const w3 = WORDLIST[h3 % size];

    return `${w0}-${w1}-${w2}-${w3}`;
}
