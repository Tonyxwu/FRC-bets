(function () {
  const KEY = "frc_bet_token";
  const USER_KEY = "frc_bet_user";

  window.auth = {
    getToken() {
      return localStorage.getItem(KEY);
    },
    setToken(token, user) {
      if (token) localStorage.setItem(KEY, token);
      else localStorage.removeItem(KEY);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
      else localStorage.removeItem(USER_KEY);
    },
    getUser() {
      try {
        const s = localStorage.getItem(USER_KEY);
        return s ? JSON.parse(s) : null;
      } catch (_) {
        return null;
      }
    },
    getAuthHeader() {
      const t = localStorage.getItem(KEY);
      return t ? { Authorization: "Bearer " + t } : {};
    },
    async fetchMe() {
      const t = localStorage.getItem(KEY);
      if (!t) return null;
      const res = await fetch("/api/me", { headers: { Authorization: "Bearer " + t } });
      if (!res.ok) {
        this.setToken(null, null);
        return null;
      }
      const data = await res.json();
      const user = data.user;
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      return user;
    },
    logout() {
      this.setToken(null, null);
    },
    isLoggedIn() {
      return !!localStorage.getItem(KEY);
    },
  };
})();
