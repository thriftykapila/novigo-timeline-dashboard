import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import App from "./App";
import "./styles.css";
const theme = createTheme({
  palette: {
    primary: { main: "#29277c" },
    background: { default: "#f5f6f9", paper: "#fff" },
    text: { primary: "#202839", secondary: "#657087" },
    success: { main: "#178b7d" },
    error: { main: "#c53a3a" },
  },
  typography: {
    fontFamily:
      'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    button: { textTransform: "none", fontWeight: 500 },
    h1: { fontWeight: 700 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: 40 },
        outlined: { borderColor: "#d7dae5" },
      },
    },
    MuiTextField: { defaultProps: { variant: "outlined" } },
    MuiSelect: { styleOverrides: { select: { fontSize: 14 } } },
    MuiInputLabel: { styleOverrides: { root: { fontSize: 14 } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { backgroundColor: "#fff" },
        notchedOutline: { borderColor: "#d7dce6" },
      },
    },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: { retry: false },
  },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
