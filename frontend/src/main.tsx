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

function Protected({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  { path: "/checkin/:token", element: <CheckIn /> },
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
      { path: "activity", element: <Activity /> },
      { path: "settings", element: <Settings /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
