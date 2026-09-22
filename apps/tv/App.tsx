import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet } from "react-native";
import { Shell } from "@/components/Shell";
import { clearToken, getToken, onSessionExpired } from "@/lib/auth-token";
import { loadServerUrl } from "@/lib/config";
import { persister, queryClient } from "@/lib/query-client";
import { TrpcProvider } from "@/lib/trpc-react";
import { WatchProgressProvider } from "@/lib/watch-progress";
import { LoginScreen } from "@/screens/LoginScreen";
import { ServerScreen } from "@/screens/ServerScreen";
import { colors } from "@/theme";

/** "server": choosing (or changing) the OwnTube server, before sign-in. */
type AuthState = "checking" | "server" | "signedOut" | "signedIn";

export default function App() {
  const [auth, setAuth] = useState<AuthState>("checking");

  useEffect(() => {
    Promise.all([loadServerUrl(), getToken()]).then(([server, token]) => {
      // Ask for a server only on a fresh install: a TV already signed in
      // predates the setting and keeps using the server it was built for.
      setAuth(token ? "signedIn" : server ? "signedOut" : "server");
    });
  }, []);

  useEffect(() => onSessionExpired(() => setAuth("signedOut")), []);

  const signOut = () => {
    clearToken().then(() => setAuth("signedOut"));
  };

  /** Another server's data must not linger: sign out and drop the cache. */
  const changeServer = () => {
    clearToken()
      .then(() => {
        queryClient.clear();
        return persister.removeClient();
      })
      .finally(() => setAuth("server"));
  };

  return (
    <TrpcProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar hidden />
        {auth === "checking" ? (
          <ActivityIndicator
            style={styles.centered}
            size="large"
            color={colors.brand}
          />
        ) : auth === "signedIn" ? (
          <WatchProgressProvider>
            <Shell onSignOut={signOut} onChangeServer={changeServer} />
          </WatchProgressProvider>
        ) : auth === "server" ? (
          <ServerScreen onDone={() => setAuth("signedOut")} />
        ) : (
          <LoginScreen
            onLoggedIn={() => setAuth("signedIn")}
            onChangeServer={() => setAuth("server")}
          />
        )}
      </SafeAreaView>
    </TrpcProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1 },
});
