import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource-variable/newsreader/opsz.css";
import "./index.css";
import { AuthProvider, useAuth } from "./auth";
import Layout from "./components/Layout";
import { Loading } from "./components/ui";
import Login from "./pages/Login";
import Today from "./pages/Today";
import Clients from "./pages/Clients";
import ClientPage from "./pages/ClientPage";
import SessionNote from "./pages/SessionNote";
import Activity from "./pages/Activity";
import Settings from "./pages/Settings";
import CheckIn from "./pages/CheckIn";
import LetterEditor from "./pages/LetterEditor";
import { PrintClient, PrintLetter, PrintSession } from "./pages/PrintPages";
import Landing from "./pages/Landing";
import Join from "./pages/Join";
import Team from "./pages/Team";
import Supervision from "./pages/Supervision";
import Referrals from "./pages/Referrals";
import Reports from "./pages/Reports";
import { GroupDetail, GroupsList } from "./pages/Groups";
import FieldPage from "./pages/Field";

function Protected({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  if (!ready) return <Loading />;
  // Visitors to the home page see the landing page; deep links go to sign-in.
  // Offline with no session: the field kit is the part of Kumbuka that works without a connection.
  if (!me && !navigator.onLine) return <Navigate to="/field" replace />;
  if (!me) return <Navigate to={window.location.pathname === "/" ? "/welcome" : "/login"} replace />;
  return <>{children}</>;
}

const router = createBrowserRouter([
  { path: "/welcome", element: <Landing /> },
  { path: "/join/:token", element: <Join /> },
  { path: "/login", element: <Login /> },
  { path: "/checkin/:token", element: <CheckIn /> },
  { path: "/field", element: <FieldPage /> },
  { path: "/print/session/:id", element: <Protected><PrintSession /></Protected> },
  { path: "/print/client/:id", element: <Protected><PrintClient /></Protected> },
  { path: "/print/letter/:id", element: <Protected><PrintLetter /></Protected> },
  {
    element: <Protected><Layout /></Protected>,
    children: [
      { index: true, element: <Today /> },
      { path: "clients", element: <Clients /> },
      { path: "clients/:id", element: <ClientPage /> },
      { path: "sessions/:id", element: <SessionNote /> },
      { path: "letters/:id", element: <LetterEditor /> },
      { path: "groups", element: <GroupsList /> },
      { path: "groups/:id", element: <GroupDetail /> },
      { path: "referrals", element: <Referrals /> },
      { path: "supervision", element: <Supervision /> },
      { path: "reports", element: <Reports /> },
      { path: "team", element: <Team /> },
      { path: "activity", element: <Activity /> },
      { path: "settings", element: <Settings /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
