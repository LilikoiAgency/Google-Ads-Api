import '@testing-library/jest-dom';

// next/font is a Next.js compile-time loader; under vitest a font is a plain
// object with the same shape (className, variable, style).
const fakeFont = () => ({ className: "font", variable: "font", style: {} });
vi.mock("next/font/local", () => ({ default: fakeFont }));
vi.mock("next/font/google", () => ({ Newsreader: fakeFont, Public_Sans: fakeFont }));
