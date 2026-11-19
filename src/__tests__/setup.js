import '@testing-library/jest-dom';

// next/font is a Next.js compile-time loader; under vitest each font is a plain
// object with the same shape (className, variable, style).
vi.mock("next/font/google", () => {
  const font = (name) => () => ({ className: `font-${name}`, variable: `font-${name}`, style: {} });
  return { Newsreader: font("newsreader"), Public_Sans: font("public-sans") };
});
