"use client";
import { createContext, useContext, useState } from "react";

const MobileNavContext = createContext({ navOpen: false, setNavOpen: () => {} });

export function MobileNavProvider({ children }) {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <MobileNavContext.Provider value={{ navOpen, setNavOpen }}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav() {
  return useContext(MobileNavContext);
}
