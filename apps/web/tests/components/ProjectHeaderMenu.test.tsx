import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { ProjectHeaderMenu } from '../../src/components/ProjectHeaderMenu';

type Props = Parameters<typeof ProjectHeaderMenu>[0];

describe('ProjectHeaderMenu', () => {
  let dom: JSDOM;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = dom.window.document.querySelector('#root') as HTMLDivElement;
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    dom.window.close();
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'HTMLElement');
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  });

  function render(props: Partial<Props> = {}) {
    act(() => {
      root.render(
        <ProjectHeaderMenu
          projectName="Agent native design"
          onRename={props.onRename ?? (() => {})}
          onDuplicate={props.onDuplicate}
          duplicateBusy={props.duplicateBusy}
          onDelete={props.onDelete}
        />,
      );
    });
  }

  function openMenu() {
    const trigger = host.querySelector(
      '[data-testid="project-header-menu-trigger"]',
    ) as HTMLButtonElement;
    act(() => {
      Simulate.click(trigger);
    });
  }

  function menuItems(): HTMLButtonElement[] {
    const menu = host.querySelector('[data-testid="project-header-menu"]');
    return menu ? Array.from(menu.querySelectorAll('[role="menuitem"]')) : [];
  }

  it('keeps the menu closed until the chevron is clicked', () => {
    render({ onDuplicate: () => {}, onDelete: () => {} });
    expect(host.querySelector('[data-testid="project-header-menu"]')).toBeNull();
    openMenu();
    expect(host.querySelector('[data-testid="project-header-menu"]')).not.toBeNull();
  });

  it('shows Rename, Duplicate, and Delete when all actions are available', () => {
    render({ onDuplicate: () => {}, onDelete: () => {} });
    openMenu();
    const labels = menuItems().map((b) => b.textContent);
    expect(labels).toEqual(['Rename', 'Duplicate project', 'Delete']);
  });

  it('hides Duplicate and Delete when their handlers are omitted', () => {
    render();
    openMenu();
    const labels = menuItems().map((b) => b.textContent);
    expect(labels).toEqual(['Rename']);
  });

  it('invokes onDuplicate and closes the menu', () => {
    const onDuplicate = vi.fn();
    render({ onDuplicate, onDelete: () => {} });
    openMenu();
    const dup = menuItems().find((b) => b.textContent === 'Duplicate project')!;
    act(() => {
      Simulate.click(dup);
    });
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="project-header-menu"]')).toBeNull();
  });

  it('disables Duplicate while a duplicate is in flight', () => {
    render({ onDuplicate: () => {}, duplicateBusy: true });
    openMenu();
    const dup = menuItems().find((b) => b.textContent === 'Duplicate project')!;
    expect(dup.disabled).toBe(true);
  });

  it('opens a rename dialog seeded with the current name', () => {
    render();
    openMenu();
    const rename = menuItems().find((b) => b.textContent === 'Rename')!;
    act(() => {
      Simulate.click(rename);
    });
    const input = host.querySelector('.modal-rename input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe('Agent native design');
  });

  it('routes a delete only after the confirm dialog is accepted', () => {
    const onDelete = vi.fn();
    render({ onDelete });
    openMenu();
    const del = menuItems().find((b) => b.textContent === 'Delete')!;
    act(() => {
      Simulate.click(del);
    });
    // The destructive action is gated behind a confirmation dialog.
    expect(onDelete).not.toHaveBeenCalled();
    const confirm = host.querySelector(
      '.modal-confirm button.danger',
    ) as HTMLButtonElement | null;
    expect(confirm).not.toBeNull();
    act(() => {
      Simulate.click(confirm!);
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
