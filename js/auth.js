//====================
// Authentification (Supabase)
//====================

// Clé PUBLIQUE (anon/publishable) — faite pour être dans le code du site/app.
// La sécurité est assurée par les policies RLS en base, pas en cachant cette
// clé. Disponible dans Supabase > Settings > API si besoin de la régénérer.
const SUPABASE_URL = "https://jbcoatxrjavrrqiwrpwu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_sh1HjB_jA0VrFOg1d_k4pg_ztOkhaKM";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,   // garde la session dans le navigateur (localStorage)
        autoRefreshToken: true, // renouvelle automatiquement le token avant expiration
        detectSessionInUrl: true,
    },
});

// Infos du joueur connecté, utilisées par sync.js/game.js pour savoir "qui
// capture quoi" et quelle couleur lui appliquer (color_index vient de la
// base, attribué une fois pour toutes à l'inscription — voir sync.js).
let currentUserId = null;
let currentUsername = null;
let currentColorIndex = 0;

let authMode = "login"; // "login" ou "signup"

// Email/pseudo en attente de confirmation par code (le temps que le joueur
// tape le code reçu par email)
let pendingSignupEmail = null;
let pendingSignupUsername = null;


//====================
// Initialisation : vérifie si une session existe déjà
//====================

async function initAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (session) {
        const profile = await fetchProfile(session.user.id);
        currentUserId = session.user.id;
        currentUsername = profile ? profile.username : null;
        currentColorIndex = profile ? profile.color_index : 0;
        hideAuthScreen();
        startGameAfterAuth(currentUsername);
    } else {
        showAuthScreen();
    }

    setupAuthFormListeners();
}

// Récupère le pseudo et la couleur attribuée au compte, depuis la table profiles
async function fetchProfile(userId) {
    const { data, error } = await supabaseClient
        .from("profiles")
        .select("username, color_index")
        .eq("id", userId)
        .single();

    if (error || !data) return null;
    return data;
}


//====================
// Affichage / masquage de l'écran de connexion
//====================

function showAuthScreen() {
    document.getElementById("authScreen").style.display = "flex";
}
function hideAuthScreen() {
    document.getElementById("authScreen").style.display = "none";
}

function showAuthError(message) {
    const el = document.getElementById("authError");
    el.textContent = message;
    el.style.display = "block";
}
function clearAuthError() {
    const el = document.getElementById("authError");
    el.textContent = "";
    el.style.display = "none";
}

// Bascule entre "Connexion" et "Créer un compte"
function switchAuthMode() {
    authMode = authMode === "login" ? "signup" : "login";
    clearAuthError();

    const usernameField = document.getElementById("authUsername");
    const submitBtn = document.getElementById("authSubmitBtn");
    const switchText = document.getElementById("authSwitchText");

    if (authMode === "signup") {
        usernameField.style.display = "block";
        submitBtn.textContent = "Créer mon compte";
        switchText.innerHTML = 'Déjà un compte ? <span id="authSwitchLink">Se connecter</span>';
    } else {
        usernameField.style.display = "none";
        submitBtn.textContent = "Connexion";
        switchText.innerHTML = 'Pas encore de compte ? <span id="authSwitchLink">Créer un compte</span>';
    }

    // Le lien a été recréé dans le innerHTML, il faut réattacher son événement
    document.getElementById("authSwitchLink").addEventListener("click", switchAuthMode);
}


//====================
// Soumission du formulaire
//====================

async function handleAuthSubmit() {
    clearAuthError();

    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    const username = document.getElementById("authUsername").value.trim();

    if (!email || !password) {
        showAuthError("Email et mot de passe requis.");
        return;
    }

    const submitBtn = document.getElementById("authSubmitBtn");
    submitBtn.disabled = true;
    submitBtn.textContent = "…";

    if (authMode === "signup") {
        await handleSignUp(email, password, username);
    } else {
        await handleLogin(email, password);
    }

    submitBtn.disabled = false;
    submitBtn.textContent = authMode === "signup" ? "Créer mon compte" : "Connexion";
}

async function handleSignUp(email, password, username) {
    if (!username) {
        showAuthError("Choisis un pseudo.");
        return;
    }

    const { data, error } = await supabaseClient.auth.signUp({ email, password });

    if (error) {
        showAuthError(traduireErreur(describeError(error)));
        return;
    }

    if (data.session) {
        // Confirmation par email désactivée : session immédiate
        await completeSignup(data.user.id, username);
        return;
    }

    // Pas de session immédiate à ce stade : soit une confirmation est
    // réellement nécessaire, soit Supabase a renvoyé une réponse "neutre"
    // sans session ni erreur (ex: ce compte existait déjà en attente de
    // confirmation avant qu'elle soit désactivée). Dans le doute, on tente
    // directement une connexion avec les identifiants qu'on vient de saisir
    // plutôt que de bloquer sur un code qui n'a peut-être jamais été envoyé.
    const { data: loginData } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (loginData && loginData.session) {
        await completeSignup(loginData.user.id, username);
        return;
    }

    // La connexion directe n'a pas marché non plus : là, un code est
    // vraiment nécessaire.
    pendingSignupEmail = email;
    pendingSignupUsername = username;
    showCodeScreen();
}

// Crée le profil (username, couleur) et démarre le jeu — appelée soit juste
// après l'inscription (si la confirmation email est désactivée), soit après
// validation du code à 6 chiffres (si elle est activée). Robuste au cas où
// un profil existe déjà pour ce compte (ex: une tentative précédente).
async function completeSignup(userId, username) {
    let profileData = await fetchProfile(userId);

    if (!profileData) {
        const { data, error: profileError } = await supabaseClient
            .from("profiles")
            .insert({ id: userId, username: username })
            .select()
            .single();

        if (profileError) {
            console.warn("Impossible de créer le profil :", profileError.message);
            showAuthError("Compte créé, mais le profil n'a pas pu être enregistré (" + describeError(profileError) + "). Contacte le support.");
        }
        profileData = data;
    }

    currentUserId = userId;
    currentUsername = profileData ? profileData.username : username;
    currentColorIndex = profileData ? profileData.color_index : 0;

    hideAuthScreen();
    hideCodeScreen();
    startGameAfterAuth(currentUsername);
}

// Vérifie le code à 6 chiffres reçu par email
async function handleCodeSubmit() {
    clearAuthError();

    const code = document.getElementById("authCode").value.trim();
    if (!code) {
        showAuthError("Entre le code reçu par email.");
        return;
    }

    const submitBtn = document.getElementById("authCodeSubmitBtn");
    submitBtn.disabled = true;
    submitBtn.textContent = "…";

    const { data, error } = await supabaseClient.auth.verifyOtp({
        email: pendingSignupEmail,
        token: code,
        type: "signup",
    });

    submitBtn.disabled = false;
    submitBtn.textContent = "Confirmer";

    if (error) {
        showAuthError("Code invalide ou expiré. Vérifie et réessaie.");
        return;
    }

    await completeSignup(data.user.id, pendingSignupUsername);
}

// Renvoie un nouveau code si le joueur ne l'a pas reçu / l'a laissé expirer
async function handleResendCode() {
    clearAuthError();
    if (!pendingSignupEmail) return;

    const { error } = await supabaseClient.auth.resend({
        type: "signup",
        email: pendingSignupEmail,
    });

    showAuthError(error ? traduireErreur(describeError(error)) : "Nouveau code envoyé !");
}

// Affiche/masque l'écran de saisie du code (par-dessus le formulaire habituel)
function showCodeScreen() {
    document.getElementById("authForm").style.display = "none";
    document.getElementById("authCodeForm").style.display = "flex";
    clearAuthError();
}
function hideCodeScreen() {
    document.getElementById("authCodeForm").style.display = "none";
    document.getElementById("authForm").style.display = "flex";
}

async function handleLogin(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
        showAuthError(traduireErreur(describeError(error)));
        return;
    }

    const profile = await fetchProfile(data.user.id);
    currentUserId = data.user.id;
    currentUsername = profile ? profile.username : null;
    currentColorIndex = profile ? profile.color_index : 0;

    hideAuthScreen();
    startGameAfterAuth(currentUsername);
}

// Traduit les messages d'erreur Supabase les plus courants en français
function traduireErreur(message) {
    if (message.includes("Invalid login credentials")) return "Email ou mot de passe incorrect.";
    if (message.includes("User already registered")) return "Un compte existe déjà avec cet email.";
    if (message.includes("Password should be at least")) return "Le mot de passe doit faire au moins 6 caractères.";
    return message;
}

// Garantit toujours un texte lisible à afficher, même si l'erreur renvoyée
// n'a pas de .message exploitable (ex: échec réseau, projet Supabase en
// pause) — pour ne plus jamais se retrouver avec un "{}" vide à l'écran
// sans indice sur la vraie cause.
function describeError(error) {
    if (!error) return "Erreur inconnue.";
    if (error.message) return error.message;
    try {
        return "Erreur sans détail (" + JSON.stringify(error) + ")";
    } catch (e) {
        return "Erreur sans détail exploitable.";
    }
}


//====================
// Écouteurs d'événements du formulaire
//====================

function setupAuthFormListeners() {
    document.getElementById("authSubmitBtn").addEventListener("click", handleAuthSubmit);
    document.getElementById("authSwitchLink").addEventListener("click", switchAuthMode);

    document.getElementById("authPassword").addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleAuthSubmit();
    });

    document.getElementById("authPasswordToggle").addEventListener("click", togglePasswordVisibility);

    document.getElementById("authCodeSubmitBtn").addEventListener("click", handleCodeSubmit);
    document.getElementById("authResendLink").addEventListener("click", handleResendCode);
    document.getElementById("authCode").addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleCodeSubmit();
    });
}

// Bascule l'affichage en clair / masqué du mot de passe (utilisé aussi bien
// à la connexion qu'à l'inscription, les deux partagent le même champ)
function togglePasswordVisibility() {
    const input = document.getElementById("authPassword");
    const showIcon = document.getElementById("authPasswordToggleIconShow");
    const hideIcon = document.getElementById("authPasswordToggleIconHide");
    const btn = document.getElementById("authPasswordToggle");

    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    showIcon.style.display = isHidden ? "none" : "block";
    hideIcon.style.display = isHidden ? "block" : "none";
    btn.setAttribute("aria-label", isHidden ? "Masquer le mot de passe" : "Afficher le mot de passe");
}
