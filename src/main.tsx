import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import BootGate from "./components/BootGate";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BootGate>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </BootGate>
  </React.StrictMode>
);
