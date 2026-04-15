// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useTheme } from '@/lib/useTheme.js';

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to dark when no localStorage value exists', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('reads saved theme from localStorage on mount', async () => {
    localStorage.setItem('lik-theme', 'light');
    const { result } = renderHook(() => useTheme());
    await act(async () => {});
    expect(result.current.theme).toBe('light');
  });

  it('toggles from dark to light and persists to localStorage', async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => { result.current.toggleTheme(); });
    expect(result.current.theme).toBe('light');
    expect(localStorage.getItem('lik-theme')).toBe('light');
  });

  it('toggles back to dark from light', async () => {
    localStorage.setItem('lik-theme', 'light');
    const { result } = renderHook(() => useTheme());
    await act(async () => {});
    await act(async () => { result.current.toggleTheme(); });
    expect(result.current.theme).toBe('dark');
    expect(localStorage.getItem('lik-theme')).toBe('dark');
  });

  it('ignores invalid localStorage values', async () => {
    localStorage.setItem('lik-theme', 'banana');
    const { result } = renderHook(() => useTheme());
    await act(async () => {});
    expect(result.current.theme).toBe('dark');
  });
});
