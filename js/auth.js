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


//====================
// Écrans du formulaire
//====================
// Le formulaire a plusieurs "vues" :
//   login       : email + mot de passe
//   signup      : pseudo + email + mot de passe  -> code reçu par email
//   forgot      : email                          -> code reçu par email
//   codeLogin   : email (connexion sans mot de passe) -> code reçu par email
//   code        : saisie du code reçu par email (inscription, connexion ou récupération)
//   newpassword : choix du nouveau mot de passe, après un code de récupération valide

let authMode = "login";
// Pendant la saisie du code : { email, purpose: "signup" | "login" | "recovery", username }
let authPending = null;
// Supabase n'accepte qu'un email par minute et par adresse
let resendAvailableAt = 0;
const RESEND_DELAY_MS = 60 * 1000;

const AUTH_VIEWS = {
    login: {
        fields: ["email", "password"], submit: "Connexion", info: "",
        links: ["toSignup", "forgot", "codeLogin"],
    },
    signup: {
        fields: ["username", "email", "password"], submit: "Créer mon compte", info: "",
        links: ["toLogin"],
    },
    forgot: {
        fields: ["email"], submit: "Envoyer le code",
        info: "Entre ton email : on t'envoie un code pour choisir un nouveau mot de passe.",
        links: ["toLogin"],
    },
    codeLogin: {
        fields: ["email"], submit: "Envoyer le code",
        info: "Connexion sans mot de passe : on t'envoie un code par email.",
        links: ["toLogin"],
    },
    code: {
        fields: ["code"], submit: "Valider le code", info: "", // le texte est calculé (voir applyAuthModeUI)
        links: ["resend", "back"],
    },
    newpassword: {
        fields: ["password"], submit: "Enregistrer et jouer",
        info: "Code validé ! Choisis ton nouveau mot de passe.",
        links: [],
    },
};

const AUTH_LINKS = {
    toSignup:  { label: "Créer un compte",            action: () => setAuthMode("signup") },
    toLogin:   { label: "Retour à la connexion",      action: () => setAuthMode("login") },
    forgot:    { label: "Mot de passe oublié ?",      action: () => setAuthMode("forgot") },
    codeLogin: { label: "Recevoir un code par email", action: () => setAuthMode("codeLogin") },
    resend:    { label: "Renvoyer le code",           action: () => resendCode() },
    back:      { label: "Changer d'email",            action: () => leaveCodeStep() },
};


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

function showAuthInfo(message) {
    const el = document.getElementById("authInfo");
    el.textContent = message;
    el.style.display = message ? "block" : "none";
}

// Met à jour tout le formulaire selon authMode : champs, bouton, texte d'aide, liens
function applyAuthModeUI() {
    const view = AUTH_VIEWS[authMode];

    const show = (id, on) => { document.getElementById(id).style.display = on ? "block" : "none"; };
    show("authUsername", view.fields.includes("username"));
    show("authEmail", view.fields.includes("email"));
    show("authPasswordWrap", view.fields.includes("password"));
    show("authCode", view.fields.includes("code"));

    // Le champ mot de passe sert à la connexion, à l'inscription et au nouveau mot de passe
    const pwd = document.getElementById("authPassword");
    if (authMode === "newpassword") {
        pwd.placeholder = "Nouveau mot de passe";
        pwd.autocomplete = "new-password";
    } else if (authMode === "signup") {
        pwd.placeholder = "Mot de passe (6 caractères minimum)";
        pwd.autocomplete = "new-password";
    } else {
        pwd.placeholder = "Mot de passe";
        pwd.autocomplete = "current-password";
    }

    let info = view.info;
    if (authMode === "code" && authPending) {
        info = "Un code a été envoyé à " + authPending.email + ". Entre-le ci-dessous (pense à regarder les spams).";
    }
    showAuthInfo(info);

    document.getElementById("authSubmitBtn").textContent = view.submit;

    const linksEl = document.getElementById("authLinks");
    linksEl.innerHTML = "";
    view.links.forEach(name => {
        const link = document.createElement("span");
        link.className = "authLink";
        link.textContent = AUTH_LINKS[name].label;
        link.addEventListener("click", AUTH_LINKS[name].action);
        linksEl.appendChild(link);
    });
}

function setAuthMode(mode) {
    authMode = mode;
    clearAuthError();
    applyAuthModeUI();
}

function fieldValue(id) {
    return document.getElementById(id).value.trim();
}


//====================
// Soumission du formulaire
//====================

async function handleAuthSubmit() {
    clearAuthError();

    const submitBtn = document.getElementById("authSubmitBtn");
    submitBtn.disabled = true;
    submitBtn.textContent = "…";

    try {
        switch (authMode) {
            case "signup":      await handleSignUp(); break;
            case "forgot":      await handleForgot(); break;
            case "codeLogin":   await handleCodeLoginRequest(); break;
            case "code":        await handleCodeSubmit(); break;
            case "newpassword": await handleNewPassword(); break;
            default:            await handleLogin();
        }
    } catch (e) {
        showAuthError(traduireErreur(describeError(e)));
    }

    submitBtn.disabled = false;
    submitBtn.textContent = AUTH_VIEWS[authMode].submit;
}

// Passe à la saisie du code (l'email vient d'être envoyé)
function goToCodeStep(pending) {
    authPending = pending;
    resendAvailableAt = Date.now() + RESEND_DELAY_MS;
    document.getElementById("authCode").value = "";
    setAuthMode("code");
}

// Retour depuis la saisie du code pour corriger l'adresse email
function leaveCodeStep() {
    const purpose = authPending ? authPending.purpose : "login";
    authPending = null;
    setAuthMode(purpose === "signup" ? "signup" : purpose === "recovery" ? "forgot" : "codeLogin");
}

// Pseudo choisi à l'inscription, gardé par Supabase dans les métadonnées du compte :
// permet de créer le profil même si l'inscription et la première connexion
// se font sur deux appareils ou à des moments différents.
function usernameFromUser(user) {
    if (user && user.user_metadata && user.user_metadata.username) return user.user_metadata.username;
    if (user && user.email) return user.email.split("@")[0];
    return null;
}

// Inscription : Supabase envoie par email un code à 6 chiffres (modèle "Confirm signup")
async function handleSignUp() {
    const email = fieldValue("authEmail");
    const password = document.getElementById("authPassword").value;
    const username = fieldValue("authUsername");

    if (!username) { showAuthError("Choisis un pseudo."); return; }
    if (!email || !password) { showAuthError("Email et mot de passe requis."); return; }
    if (password.length < 6) { showAuthError("Le mot de passe doit faire au moins 6 caractères."); return; }

    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { username } },
    });

    if (error) {
        showAuthError(traduireErreur(describeError(error)));
        return;
    }

    if (data.session) {
        // Confirmation par email désactivée côté Supabase : session immédiate
        await completeSignup(data.user.id, username);
        return;
    }

    // Par sécurité, Supabase ne renvoie pas d'erreur si l'adresse a déjà un
    // compte confirmé : il renvoie un compte sans aucune identité.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        showAuthError("Un compte existe déjà avec cet email. Connecte-toi, ou utilise « Mot de passe oublié ? ».");
        return;
    }

    goToCodeStep({ email, purpose: "signup", username });
}

// Connexion classique, email + mot de passe
async function handleLogin() {
    const email = fieldValue("authEmail");
    const password = document.getElementById("authPassword").value;

    if (!email || !password) { showAuthError("Email et mot de passe requis."); return; }

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
        // Compte créé mais jamais confirmé : on renvoie un code et on passe à sa saisie
        if (/Email not confirmed/i.test(describeError(error))) {
            const { error: resendError } = await supabaseClient.auth.resend({ type: "signup", email });
            if (resendError) {
                showAuthError(traduireErreur(describeError(resendError)));
                return;
            }
            goToCodeStep({ email, purpose: "signup", username: null });
            return;
        }
        showAuthError(traduireErreur(describeError(error)));
        return;
    }

    await completeSignup(data.user.id, usernameFromUser(data.user));
}

// Mot de passe oublié : code de récupération par email (modèle "Reset password")
async function handleForgot() {
    const email = fieldValue("authEmail");
    if (!email) { showAuthError("Entre ton email."); return; }

    const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
    if (error) {
        showAuthError(traduireErreur(describeError(error)));
        return;
    }

    // Supabase répond pareil que l'adresse existe ou non (pour ne pas révéler qui a un compte)
    goToCodeStep({ email, purpose: "recovery", username: null });
}

// Connexion sans mot de passe : code par email (modèle "Magic link"), comptes existants seulement
async function handleCodeLoginRequest() {
    const email = fieldValue("authEmail");
    if (!email) { showAuthError("Entre ton email."); return; }

    const { error } = await supabaseClient.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
    });
    if (error) {
        showAuthError(traduireErreur(describeError(error)));
        return;
    }

    goToCodeStep({ email, purpose: "login", username: null });
}

// Vérifie le code saisi
async function handleCodeSubmit() {
    if (!authPending) { setAuthMode("login"); return; }

    const token = document.getElementById("authCode").value.replace(/\D/g, "");
    if (token.length < 6) {
        showAuthError("Entre le code reçu par email (6 chiffres).");
        return;
    }

    const type = authPending.purpose === "signup" ? "signup"
               : authPending.purpose === "recovery" ? "recovery"
               : "email";

    const { data, error } = await supabaseClient.auth.verifyOtp({
        email: authPending.email,
        token,
        type,
    });

    if (error || !data || !data.user) {
        showAuthError(traduireErreur(describeError(error)));
        return;
    }

    // Récupération : le code ouvre une session, il reste à choisir le nouveau mot de passe
    if (authPending.purpose === "recovery") {
        setAuthMode("newpassword");
        document.getElementById("authPassword").value = "";
        return;
    }

    const username = authPending.username || usernameFromUser(data.user);
    authPending = null;
    await completeSignup(data.user.id, username);
}

// Enregistre le nouveau mot de passe (session de récupération déjà ouverte), puis lance le jeu
async function handleNewPassword() {
    const password = document.getElementById("authPassword").value;
    if (password.length < 6) {
        showAuthError("Le mot de passe doit faire au moins 6 caractères.");
        return;
    }

    const { data, error } = await supabaseClient.auth.updateUser({ password });
    if (error) {
        showAuthError(traduireErreur(describeError(error)));
        return;
    }

    authPending = null;
    await completeSignup(data.user.id, usernameFromUser(data.user));
}

// Renvoie un code (au plus un par minute : limite de Supabase)
async function resendCode() {
    if (!authPending) return;

    const waitSeconds = Math.ceil((resendAvailableAt - Date.now()) / 1000);
    if (waitSeconds > 0) {
        showAuthError("Attends encore " + waitSeconds + " s avant de renvoyer un code.");
        return;
    }
    clearAuthError();

    const { email, purpose } = authPending;
    let result;
    if (purpose === "signup") {
        result = await supabaseClient.auth.resend({ type: "signup", email });
    } else if (purpose === "recovery") {
        result = await supabaseClient.auth.resetPasswordForEmail(email);
    } else {
        result = await supabaseClient.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    }

    if (result.error) {
        showAuthError(traduireErreur(describeError(result.error)));
        return;
    }

    resendAvailableAt = Date.now() + RESEND_DELAY_MS;
    showAuthInfo("Nouveau code envoyé à " + email + ".");
}

// Crée le profil (username, couleur) si besoin et démarre le jeu — appelée
// une fois le joueur authentifié (code validé, mot de passe, ou session déjà
// ouverte). Robuste au cas où un profil existe déjà pour ce compte.
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
    startGameAfterAuth(currentUsername);
}

// Traduit les messages d'erreur Supabase les plus courants en français
function traduireErreur(message) {
    if (/Invalid login credentials/i.test(message)) return "Email ou mot de passe incorrect.";
    if (/Email not confirmed/i.test(message)) return "Confirme d'abord ton compte avec le code reçu par email.";
    if (/User already registered/i.test(message)) return "Un compte existe déjà avec cet email.";
    if (/Password should be at least/i.test(message)) return "Le mot de passe doit faire au moins 6 caractères.";
    if (/Token has expired or is invalid|otp_expired|invalid.*token/i.test(message)) return "Code invalide ou expiré. Vérifie-le, ou demande un nouveau code.";
    if (/you can only request this after/i.test(message)) {
        const m = message.match(/after (\d+) seconds?/i);
        return "Trop de demandes : réessaie dans " + (m ? m[1] + " s." : "quelques instants.");
    }
    if (/rate limit/i.test(message)) return "Trop d'emails envoyés pour le moment. Réessaie dans quelques minutes.";
    if (/Signups not allowed for otp/i.test(message)) return "Aucun compte avec cet email.";
    if (/New password should be different/i.test(message)) return "Choisis un mot de passe différent de l'ancien.";
    if (/Unable to validate email address|invalid format|is invalid/i.test(message) && /email/i.test(message)) return "Adresse email invalide.";
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

    ["authUsername", "authEmail", "authPassword", "authCode"].forEach(id => {
        document.getElementById(id).addEventListener("keydown", (e) => {
            if (e.key === "Enter") handleAuthSubmit();
        });
    });

    // Le code ne contient que des chiffres : on retire espaces et tirets collés depuis l'email
    document.getElementById("authCode").addEventListener("input", (e) => {
        e.target.value = e.target.value.replace(/\D/g, "");
    });

    document.getElementById("authPasswordToggle").addEventListener("click", togglePasswordVisibility);

    applyAuthModeUI();
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
