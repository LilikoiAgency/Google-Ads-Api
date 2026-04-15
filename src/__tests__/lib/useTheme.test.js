// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useTheme } from '@/lib/useTheme.js';

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to light when no localStorage value exists', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });

  it('reads saved dark theme from localStorage immediately on mount', () => {
    localStorage.setItem('lik-theme', 'dark');
    const { result } = renderHook(() => useTheme());
    // Lazy initializer — no async needed, value is set synchronously
    expect(result.current.theme).toBe('dark');
  });

  it('reads saved light theme from localStorage immediately on mount', () => {
    localStorage.setItem('lik-theme', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });

  it('toggles from light to dark and persists to localStorage', async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => { result.current.toggleTheme(); });
    expect(result.current.theme).toBe('dark');
    expect(localStorage.getItem('lik-theme')).toBe('dark');
  });

  it('toggles back to light from dark', async () => {
    localStorage.setItem('lik-theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    await act(async () => { result.current.toggleTheme(); });
    expect(result.current.theme).toBe('light');
    expect(localStorage.getItem('lik-theme')).toBe('light');
  });

  it('ignores invalid localStorage values and falls back to light', () => {
    localStorage.setItem('lik-theme', 'banana');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });
});
