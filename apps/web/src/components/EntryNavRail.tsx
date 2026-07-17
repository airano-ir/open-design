// Team-edition entry navigation rail (Lovart/Manus-style labeled column).
//
// Structure — faithfully ported from the design demo
// (origin/demo/workspace-team-features) but wired to the REAL workspace context
// (`GET /api/workspace/context`, shared via `useWorkspaceContext`), never the
// demo's hardcoded 琼羽 / Refly / 800 placeholders:
//
//   • Account section (top) — real `context.displayName` + an account menu
//     (theme / language / settings / GitHub help / feature request / sign out).
//     Falls back to the brand logo when there is no cloud identity
//     (context === null).
//   • Credits chip — real plan tier + balance when A's vela CLI billing summary
//     is available, with upgrade linking out to Vela Web.
//   • Search box (readonly, decorative).
//   • 最近 (Recents) → home, Community → community.
//   • Team block (only when `context.workspaceType === 'team'`): an inline team
//     switcher + the team destinations. In-client views: drafts / all projects /
//     design systems / 扩展 (plugins). Member management lives in B's vela/web
//     console, so 成员 / 数据大盘 / Workspace 设置 link OUT to it (target=_blank),
//     derived from `context.workspaceSettingsUrl`.
//
// The gate is `workspaceType` + permissions, never the billing/provider axis — a
// personal_byok workspace still has full team features.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { coalescedGet } from '../lib/coalesced-get';
import type {
  WorkspaceActiveResponse,
  WorkspaceBillingSummary,
  WorkspaceCollabContext,
  WorkspaceDirectoryItem,
  WorkspaceDirectoryResponse,
} from '@open-design/contracts';
import { fetchVelaLoginStatus, velaLogout } from '../providers/daemon';
import { notifyAmrLoginStatusChanged } from './amrLoginPolling';
import { Icon } from './Icon';
import { GITHUB_STARS_FALLBACK_LABEL, formatStars, useGithubStars } from './useGithubStars';
import { PlanWordmark, planBadgeTierForLabel } from './PlanWordmark';
import { RemixIcon } from './RemixIcon';
import { InviteDialog } from './InviteDialog';
import { CreditsPanel } from './CreditsPanel';
import { LOCALE_LABEL, LOCALES, useI18n } from '../i18n';
import {
  notifyTeamProjectsChanged,
  notifyWorkspaceBillingRefresh,
  notifyWorkspaceContextRefresh,
} from '../collab/useWorkspaceContext';
import type { EntryHomeView } from '../router';

const REPO_URL = 'https://github.com/nexu-io/open-design';
const GITHUB_HELP_URL = `${REPO_URL}/issues/new`;
const GITHUB_FEATURE_URL = `${REPO_URL}/pulls`;
const DISCORD_URL = 'https://discord.gg/mHAjSMV6gz';
const X_URL = 'https://x.com/OpenDesignHQ';
const CONTACT_EMAIL_URL = 'mailto:contact@open.design';
const externalLinkProps = { target: '_blank', rel: 'noreferrer noopener' } as const;

// The rail's destination ids are the entry-shell home views (kept in sync with
// the router so `navigate({ kind: 'home', view })` type-checks for every item).
export type EntryView = EntryHomeView;

interface Props {
  view: EntryView;
  onViewChange: (view: EntryView) => void;
  onNewProject: () => void;
  newProjectDisabled?: boolean;
  /** When false the rail is collapsed (hidden off-canvas) on the entry view. */
  open: boolean;
  /** Collapse the rail — called when the user dismisses it (topbar toggle). */
  onClose: () => void;
  /** The one shared workspace context; null → local (no cloud identity) state. */
  context: WorkspaceCollabContext | null;
  /** Real billing summary (A-lane, via the vela CLI 收口). Null → the credits
   *  chip falls back to the context plan-tier hint with no balance. */
  billing?: WorkspaceBillingSummary | null;
  /** Open the app settings dialog. */
  onOpenSettings?: () => void;
  /** Flip the effective theme (light ⇄ dark). Omitted → the theme item is hidden. */
  onToggleTheme?: () => void;
  /** Open the members / invite slot (B's InviteDialog). */
  onInvite?: () => void;
  /** Start the cloud sign-in / team flow from the local-state callout. */
  onSignInCloud?: () => void;
  /** Extra controls pinned to the bottom-left of the rail. */
  footerExtra?: ReactNode;
  /** Optional notice shown above the footer controls. */
  footerNotice?: ReactNode;
}

interface NavButtonProps {
  active?: boolean;
  ariaLabel: string;
  tooltip: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  children: ReactNode;
}

function NavButton({ active, ariaLabel, tooltip, onClick, disabled, testId, children }: NavButtonProps) {
  return (
    <button
      type="button"
      className={`entry-nav-rail__btn${active ? ' is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-current={active ? 'page' : undefined}
      data-tooltip={tooltip}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <span className="entry-nav-rail__btn-icon" aria-hidden>{children}</span>
      <span className="entry-nav-rail__btn-label">{tooltip}</span>
    </button>
  );
}

// Team management (members, dashboard, settings) lives in B's vela/web console,
// not the local client. We link out to it, deriving the section path from the one
// workspace-settings URL the context carries. Best-effort: swap/append the section
// segment, falling back to the raw settings URL when the path can't be rewritten.
function teamConsoleUrl(base: string, section: 'members' | 'dashboard' | 'settings' | 'billing'): string {
  try {
    const url = new URL(base);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length > 0 && segments[segments.length - 1] === 'settings') {
      segments[segments.length - 1] = section;
    } else {
      segments.push(section);
    }
    url.pathname = `/${segments.join('/')}`;
    return url.toString();
  } catch {
    return base;
  }
}

/** Map a raw vela membership tier to a display label for the credits chip. */
function formatBillingTier(tier: string, t: ReturnType<typeof useI18n>['t']): string {
  switch (tier) {
    case 'team':
      return t('entry.billingTierTeam');
    case 'free':
      return t('entry.billingTierFree');
    case 'pro':
      return t('entry.billingTierPro');
    default:
      return tier;
  }
}

export function EntryNavRail({
  view,
  onViewChange,
  onNewProject,
  newProjectDisabled,
  open,
  onClose,
  context,
  billing,
  onOpenSettings,
  onToggleTheme,
  footerExtra,
  footerNotice,
}: Props) {
  const { t, locale, setLocale } = useI18n();
  const brandLabel = t('app.brand');
  const communityLabel = t('pluginsHome.title');
  // #5517 reads the home view as "Recents" (the home IS the recent-projects
  // grid), so the rail's first item says 最近, not 主页.
  const homeLabel = t('entry.navRecents');
  const isHome = view === 'home';

  const isTeam = Boolean(context) && context!.workspaceType === 'team';
  const permissions = context?.permissions;
  // Demo `canManageWorkspace` → real `canManageMembers`; demo `canOwnWorkspace` →
  // real owner-level view of workspace settings. Never re-derive from role — the
  // permission bits already fold role + lifecycle in.
  const canManageMembers = Boolean(permissions?.canManageMembers);
  const canViewWorkspaceSettings = Boolean(permissions?.canViewWorkspaceSettings);
  const canInviteMembers = Boolean(permissions?.canInviteMembers);
  const workspaceSettingsUrl = context?.workspaceSettingsUrl?.trim() || null;

  // Account identity (real). No email field on the context → the head shows the
  // avatar + name only.
  const displayName = context?.displayName?.trim() || '';
  const accountName = displayName || brandLabel;
  const accountInitial = accountName.charAt(0).toUpperCase() || '·';

  // Credits chip: prefer the real billing summary (A-lane, via the vela CLI
  // 收口); fall back to the context plan-tier hint with no balance when billing
  // hasn't loaded / no session.
  const tierLabel = billing?.membershipTier
    ? formatBillingTier(billing.membershipTier, t)
    : context?.planId?.trim() || (isTeam ? t('entry.billingTierTeam') : t('entry.billingTierFree'));
  const creditsBalance = billing ? billing.totalAvailableCredits : null;
  // #5517: wordmark badge on the account row (replaces the chevron) and a
  // small twin inside the menu's billing card. Derive from the raw tier id
  // first so "team_plus" maps to the plus badge regardless of display label.
  // `||` not `??`: the billing endpoint reports an EMPTY membershipTier while
  // the plan hint lives on context.planId, and the empty string must fall
  // through to the label.
  const planTier = planBadgeTierForLabel(billing?.membershipTier || tierLabel);

  const [accountOpen, setAccountOpen] = useState(false);
  const githubStars = useGithubStars();
  // Signed-in account email for the menu head (#5517 shows it under the
  // display name). The workspace context carries no email, so lazily read the
  // vela login-status projection the first time the menu opens — never on
  // mount, so shells without an open menu spend zero requests on it.
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!accountOpen || accountEmail !== null) return;
    let cancelled = false;
    void fetchVelaLoginStatus().then((status) => {
      if (!cancelled) setAccountEmail(status?.user?.email?.trim() || '');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountOpen]);
  // Hover-open for the account menu (#5517 interaction). The popover floats
  // above the trigger, so closing is delayed just long enough for the pointer
  // to cross the gap; re-entering the container (menu included — it's a DOM
  // child even though it renders above) cancels the pending close.
  const accountCloseTimer = useRef<number | null>(null);
  const cancelAccountClose = () => {
    if (accountCloseTimer.current !== null) {
      window.clearTimeout(accountCloseTimer.current);
      accountCloseTimer.current = null;
    }
  };
  const openAccountMenu = () => {
    cancelAccountClose();
    setAccountOpen(true);
  };
  const scheduleAccountClose = () => {
    cancelAccountClose();
    accountCloseTimer.current = window.setTimeout(() => setAccountOpen(false), 220);
  };
  useEffect(() => cancelAccountClose, []);
  // While open, track the pointer at the document level: anywhere outside the
  // account container arms the close timer, back inside disarms it. This is
  // deliberately NOT React onMouseLeave — leaving from inside the floating
  // menu does not reliably produce a synthetic leave on the container.
  const accountContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!accountOpen) return;
    const onDocPointerOver = (ev: PointerEvent) => {
      const container = accountContainerRef.current;
      if (!container) return;
      if (container.contains(ev.target as Node)) cancelAccountClose();
      else scheduleAccountClose();
    };
    document.addEventListener('pointerover', onDocPointerOver, true);
    return () => document.removeEventListener('pointerover', onDocPointerOver, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountOpen]);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [workspaceItems, setWorkspaceItems] = useState<WorkspaceDirectoryItem[]>([]);
  const [workspaceDirectoryLoading, setWorkspaceDirectoryLoading] = useState(false);
  const [workspaceSwitchingId, setWorkspaceSwitchingId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const billingUpgradeUrl =
    context?.billingRecovery?.recoveryUrl?.trim() ||
    (workspaceSettingsUrl ? teamConsoleUrl(workspaceSettingsUrl, 'billing') : null);
  // Product decision: plan selection / payment lives in Vela Web. The local
  // client opens that billing surface, then refreshes billing + context when
  // focus returns so direct web upgrades sync plan, credits, seats and gates.
  const canUpgrade = Boolean(billingUpgradeUrl && permissions?.canManageBilling);
  const currentLanguageLabel = LOCALE_LABEL[locale];
  const currentWorkspaceItem = context
    ? workspaceItems.find((item) => item.workspaceId === context.workspaceId) ?? null
    : null;
  const workspaceName =
    currentWorkspaceItem?.workspaceName?.trim() ||
    context?.teamName?.trim() ||
    context?.teamId ||
    (context?.workspaceType === 'personal' ? 'Personal workspace' : '');
  const workspaceInitial = workspaceName.charAt(0).toUpperCase() || 'W';
  const visibleWorkspaceItems =
    workspaceItems.length > 0
      ? workspaceItems
      : context
        ? [{
            workspaceId: context.workspaceId,
            workspaceName,
            workspaceType: context.workspaceType,
            workspaceMemberId: context.workspaceMemberId,
            role: context.role,
            memberStatus: context.memberStatus,
            lifecycleState: context.lifecycleState,
          } satisfies WorkspaceDirectoryItem]
        : [];

  async function loadWorkspaceDirectory() {
    setWorkspaceDirectoryLoading(true);
    try {
      const items = await coalescedGet('workspace-directory', async () => {
        const response = await fetch('/api/workspace/directory', { cache: 'no-store' });
        if (!response.ok) throw new Error(`directory ${response.status}`);
        const body = (await response.json()) as WorkspaceDirectoryResponse;
        return body.items ?? [];
      });
      setWorkspaceItems(items);
    } catch {
      setWorkspaceItems([]);
    } finally {
      setWorkspaceDirectoryLoading(false);
    }
  }

  async function switchWorkspace(workspaceId: string) {
    if (workspaceId === context?.workspaceId || workspaceSwitchingId) return;
    setWorkspaceSwitchingId(workspaceId);
    try {
      const response = await fetch('/api/workspace/active', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      if (!response.ok) return;
      const body = (await response.json()) as WorkspaceActiveResponse;
      setTeamOpen(false);
      notifyWorkspaceContextRefresh();
      notifyWorkspaceBillingRefresh();
      notifyTeamProjectsChanged();
      selectView('home');
    } catch {
      // Keep the menu open; the next open/focus refresh can retry the directory.
    } finally {
      setWorkspaceSwitchingId(null);
    }
  }

  function openBillingUpgrade() {
    if (!billingUpgradeUrl) return;
    setCreditsOpen(false);
    window.open(billingUpgradeUrl, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => {
      notifyWorkspaceBillingRefresh();
      notifyWorkspaceContextRefresh();
    }, 3000);
  }

  const selectView = (next: EntryView) => {
    onViewChange(next);
  };

  // While collapsed the rail is visually hidden but its controls stay mounted;
  // mark it `inert` so they leave the tab order and pointer flow entirely.
  const railRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = railRef.current;
    if (!node) return;
    if (open) {
      node.removeAttribute('inert');
    } else {
      node.setAttribute('inert', '');
    }
  }, [open]);

  useEffect(() => {
    if (!accountOpen) setLanguageOpen(false);
  }, [accountOpen]);

  useEffect(() => {
    if (!teamOpen) return;
    void loadWorkspaceDirectory();
  }, [teamOpen]);

  return (
    <nav
      ref={railRef}
      className={`entry-nav-rail${open ? ' is-open' : ''}`}
      aria-label={t('entry.primaryNavAria')}
      aria-hidden={open ? undefined : true}
    >
      <div className="entry-nav-rail__panel">
      <div className="entry-nav-rail__group">
        {context ? (
          <div
            ref={accountContainerRef}
            className="entry-nav-rail__account"
            onMouseEnter={cancelAccountClose}
            onMouseLeave={scheduleAccountClose}
          >
            <button
              type="button"
              className="entry-nav-rail__account-trigger"
              onClick={() => setAccountOpen((v) => !v)}
              onMouseEnter={openAccountMenu}
              aria-expanded={accountOpen}
              data-testid="entry-nav-account"
            >
              <span className="entry-nav-rail__account-avatar" aria-hidden>{accountInitial}</span>
              <span className="entry-nav-rail__account-name">{accountName}</span>
              {/* #5517: the plan badge replaces the chevron when a tier is
                  known — the standalone credits chip row is gone; credits
                  live in the account menu's billing card. */}
              {planTier ? <PlanWordmark tier={planTier} height={17} /> : <Icon name="chevron-down" size={14} />}
            </button>
            <CreditsPanel
              open={creditsOpen}
              onClose={() => setCreditsOpen(false)}
              info={{
                planName: tierLabel,
                tierLabel,
                showUpgrade: canUpgrade,
                balance: creditsBalance,
                grantTip: t('entry.creditsGrantTip'),
              }}
              onUpgrade={() => {
                openBillingUpgrade();
              }}
              memberCreditNotice={isTeam && !canManageMembers}
            />
            {accountOpen ? (
              <>
                {/* No backdrop here (unlike the team menu): hover-open relies
                    on document-level pointerover to close, and a full-screen
                    backdrop would swallow those events and insta-close. */}
                <div className="entry-nav-rail__account-menu" role="menu">
                  <div className="entry-nav-rail__account-head">
                    <span className="entry-nav-rail__account-head-avatar" aria-hidden>{accountInitial}</span>
                    <span className="entry-nav-rail__account-head-name">{accountName}</span>
                    {accountEmail ? (
                      <span className="entry-nav-rail__account-head-email">{accountEmail}</span>
                    ) : null}
                  </div>
                  {/* #5517 billing card: plan (+badge) + 升级 CTA + credits and
                      bonus rows. Credits are real billing data; the bonus row
                      mirrors #5517's static 0 (vela reports one combined
                      total). The credits row opens the full CreditsPanel. */}
                  {billing ? (
                    <div className="entry-nav-rail__menu-credits">
                      <div className="entry-nav-rail__menu-credits-head">
                        <span className="entry-nav-rail__menu-credits-plan">
                          {tierLabel}
                          {planTier ? <PlanWordmark tier={planTier} height={11} /> : null}
                        </span>
                        {canUpgrade ? (
                          <button
                            type="button"
                            className="entry-nav-rail__menu-credits-upgrade"
                            onClick={() => {
                              setAccountOpen(false);
                              openBillingUpgrade();
                            }}
                          >
                            {t('entry.creditsUpgrade')}
                          </button>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="entry-nav-rail__menu-credits-row"
                        onClick={() => {
                          setAccountOpen(false);
                          setCreditsOpen(true);
                        }}
                      >
                        <span className="entry-nav-rail__menu-credits-label">
                          <RemixIcon name="battery-charge-line" size={14} /> {t('entry.creditsRemaining')}
                        </span>
                        <span className="entry-nav-rail__menu-credits-value">
                          {creditsBalance != null ? creditsBalance.toLocaleString('en-US') : '—'}
                          <Icon name="chevron-right" size={14} />
                        </span>
                      </button>
                    </div>
                  ) : null}
                  {onToggleTheme ? (
                    <button
                      type="button"
                      className="entry-nav-rail__menu-item is-primary"
                      role="menuitem"
                      onClick={() => {
                        setAccountOpen(false);
                        onToggleTheme();
                      }}
                    >
                      <Icon name="layout" size={15} /> {t('entry.accountToggleTheme')}
                      <span className="entry-nav-rail__menu-chevron"><Icon name="chevron-right" size={13} /></span>
                    </button>
                  ) : null}
                  <div
                    className="entry-nav-rail__language-wrap"
                    onMouseEnter={() => setLanguageOpen(true)}
                    onMouseLeave={() => setLanguageOpen(false)}
                  >
                    <button
                      type="button"
                      className={`entry-nav-rail__menu-item${languageOpen ? ' is-open' : ''}`}
                      role="menuitem"
                      aria-haspopup="menu"
                      aria-expanded={languageOpen}
                      onClick={() => setLanguageOpen((value) => !value)}
                      onFocus={() => setLanguageOpen(true)}
                    >
                      <Icon name="languages" size={15} />
                      {t('entry.accountSwitchLanguage')}
                      <span className="entry-nav-rail__menu-meta">{currentLanguageLabel}</span>
                      <span className="entry-nav-rail__menu-chevron">
                        <Icon name="chevron-right" size={13} />
                      </span>
                    </button>
                    {languageOpen ? (
                      <div
                        className="entry-nav-rail__language-menu"
                        role="menu"
                        aria-label={t('entry.accountSwitchLanguage')}
                      >
                        {LOCALES.map((code) => {
                          const active = locale === code;
                          return (
                            <button
                              key={code}
                              type="button"
                              className={`entry-nav-rail__language-option${active ? ' is-active' : ''}`}
                              role="menuitemradio"
                              aria-checked={active}
                              onClick={() => {
                                setLocale(code);
                                setLanguageOpen(false);
                                setAccountOpen(false);
                              }}
                            >
                              <span>{LOCALE_LABEL[code]}</span>
                              <span className="entry-nav-rail__language-code">{code}</span>
                              {active ? <Icon name="check" size={13} /> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="entry-nav-rail__menu-item"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false);
                      onOpenSettings?.();
                    }}
                  >
                    <Icon name="settings" size={15} /> {t('entry.accountSettings')}
                  </button>
                  <div className="entry-nav-rail__menu-divider" />
                  <a
                    className="entry-nav-rail__menu-item"
                    role="menuitem"
                    href={GITHUB_HELP_URL}
                    {...externalLinkProps}
                    onClick={() => setAccountOpen(false)}
                  >
                    <Icon name="comment" size={15} /> {t('entry.accountGithubHelp')}
                  </a>
                  <a
                    className="entry-nav-rail__menu-item"
                    role="menuitem"
                    href={GITHUB_FEATURE_URL}
                    {...externalLinkProps}
                    onClick={() => setAccountOpen(false)}
                  >
                    <Icon name="sparkles" size={15} /> {t('entry.accountFeatureRequest')}
                  </a>
                  {/* #5517: the GitHub/Discord/X/mail badges move off the rail
                      footer into a compact social row inside the account menu. */}
                  <div className="entry-nav-rail__menu-social">
                    <a
                      className="entry-nav-rail__menu-social-btn"
                      role="menuitem"
                      href={REPO_URL}
                      {...externalLinkProps}
                      aria-label={`GitHub · ${githubStars == null ? GITHUB_STARS_FALLBACK_LABEL : formatStars(githubStars)} stars`}
                      title={`GitHub · ${githubStars == null ? GITHUB_STARS_FALLBACK_LABEL : formatStars(githubStars)} stars`}
                      onClick={() => setAccountOpen(false)}
                    >
                      <Icon name="github-filled" size={15} />
                      <span className="entry-nav-rail__menu-social-count">
                        {githubStars == null ? GITHUB_STARS_FALLBACK_LABEL : formatStars(githubStars)}
                      </span>
                    </a>
                    <a
                      className="entry-nav-rail__menu-social-btn"
                      role="menuitem"
                      href={DISCORD_URL}
                      {...externalLinkProps}
                      aria-label={t('entry.discordAria')}
                      title={t('entry.discordAria')}
                      onClick={() => setAccountOpen(false)}
                    >
                      <Icon name="discord" size={15} />
                    </a>
                    <a
                      className="entry-nav-rail__menu-social-btn"
                      role="menuitem"
                      href={X_URL}
                      {...externalLinkProps}
                      aria-label="@OpenDesignHQ"
                      title="@OpenDesignHQ"
                      onClick={() => setAccountOpen(false)}
                    >
                      <span className="entry-nav-rail__menu-x" aria-hidden>X</span>
                    </a>
                    <a
                      className="entry-nav-rail__menu-social-btn"
                      role="menuitem"
                      href={CONTACT_EMAIL_URL}
                      aria-label={t('entry.mailAria')}
                      title={t('entry.mailAria')}
                      onClick={() => setAccountOpen(false)}
                    >
                      <Icon name="mail" size={15} />
                    </a>
                  </div>
                  <div className="entry-nav-rail__menu-divider" />
                  <button
                    type="button"
                    className="entry-nav-rail__menu-item"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false);
                      // Real sign-out: clear the vela profile auth on the
                      // daemon, then nudge every workspace surface to re-read
                      // (the context read now resolves to null → the shell
                      // falls back to the signed-out local form).
                      void velaLogout().then(() => {
                        notifyAmrLoginStatusChanged();
                        notifyWorkspaceContextRefresh();
                        notifyWorkspaceBillingRefresh();
                        notifyTeamProjectsChanged();
                      });
                    }}
                  >
                    <Icon name="log-out" size={15} /> {t('entry.accountSignOut')}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div className="entry-nav-rail__brand">
            <button
              type="button"
              className="entry-nav-rail__local-logo"
            onClick={() => selectView('home')}
            aria-label={brandLabel}
            data-testid="entry-nav-logo"
          >
            <span
              className="entry-nav-rail__logo-img od-brand-glyph"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            className="entry-nav-rail__collapse"
            onClick={onClose}
            aria-label={t('entry.navCollapse')}
            title={t('entry.navCollapse')}
            data-testid="entry-nav-collapse"
          >
            <Icon name="panel-left" size={20} />
          </button>
          </div>
        )}

        <div className="entry-nav-rail__search" aria-hidden>
          <Icon name="search" size={14} />
          <input type="text" placeholder={t('common.search')} readOnly tabIndex={-1} />
        </div>

        <NavButton
          active={isHome}
          ariaLabel={homeLabel}
          tooltip={homeLabel}
          onClick={() => selectView('home')}
          testId="entry-nav-home"
        >
          <Icon name="home" size={16} />
        </NavButton>
        <NavButton
          active={view === 'community'}
          ariaLabel={communityLabel}
          tooltip="Community"
          onClick={() => selectView('community')}
          testId="entry-nav-community"
        >
          <Icon name="globe" size={16} />
        </NavButton>

        {context ? (
          <div className="entry-nav-rail__team-wrap">
            <button
              type="button"
              className="entry-nav-rail__team"
              onClick={() => setTeamOpen((v) => !v)}
              aria-expanded={teamOpen}
              data-testid="workspace-switcher"
            >
              <span className="entry-nav-rail__team-avatar" aria-hidden>{workspaceInitial}</span>
              <span className="entry-nav-rail__team-name">{workspaceName}</span>
              <Icon name="chevron-down" size={14} />
            </button>
            {teamOpen ? (
              <>
                <div className="entry-nav-rail__menu-backdrop" onClick={() => setTeamOpen(false)} />
                <div className="entry-nav-rail__team-menu" role="menu">
                  {visibleWorkspaceItems.map((item) => {
                    const active = item.workspaceId === context.workspaceId;
                    const initial = item.workspaceName.trim().charAt(0).toUpperCase() || 'W';
                    return (
                      <button
                        key={item.workspaceId}
                        type="button"
                        className={`entry-nav-rail__menu-item${active ? ' is-current' : ''}`}
                        role="menuitem"
                        disabled={active || workspaceSwitchingId === item.workspaceId}
                        onClick={() => {
                          void switchWorkspace(item.workspaceId);
                        }}
                      >
                        <span className="entry-nav-rail__team-avatar" aria-hidden>{initial}</span>
                        <span className="entry-nav-rail__workspace-menu-name">{item.workspaceName}</span>
                        <span className="entry-nav-rail__workspace-menu-role">{item.role}</span>
                        {active ? <Icon name="check" size={14} /> : null}
                      </button>
                    );
                  })}
                  {workspaceDirectoryLoading && visibleWorkspaceItems.length === 0 ? (
                    <div className="entry-nav-rail__menu-item is-muted" role="status">
                      {t('common.loading')}
                    </div>
                  ) : null}
                  <div className="entry-nav-rail__menu-divider" />
                  {canInviteMembers ? (
                    <button
                      type="button"
                      className="entry-nav-rail__menu-item"
                      role="menuitem"
                      onClick={() => {
                        setTeamOpen(false);
                        setInviteOpen(true);
                      }}
                    >
                      <Icon name="share" size={15} /> {t('workspaceSwitcher.invite')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="entry-nav-rail__menu-item"
                    role="menuitem"
                    onClick={() => {
                      // TODO(workspace): create-team is a B vela/web flow.
                      setTeamOpen(false);
                    }}
                  >
                    <Icon name="plus" size={15} /> {t('workspaceSwitcher.createTeam')}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {context ? (
          <>
            <NavButton
              active={view === 'drafts'}
              ariaLabel={t('entry.navDrafts')}
              tooltip={t('workspaceSwitcher.draftsTooltip')}
              onClick={() => selectView('drafts')}
              testId="entry-nav-drafts"
            >
              <Icon name="file" size={16} />
            </NavButton>
            <NavButton
              active={view === 'all-projects'}
              ariaLabel={t('entry.navAllProjects')}
              tooltip={t('workspaceSwitcher.allProjectsTooltip')}
              onClick={() => selectView('all-projects')}
              testId="entry-nav-all-projects"
            >
              <Icon name="grid" size={16} />
            </NavButton>
            <NavButton
              active={view === 'design-systems'}
              ariaLabel={t('entry.navDesignSystems')}
              tooltip={t('entry.navDesignSystems')}
              onClick={() => selectView('design-systems')}
              testId="entry-nav-design-systems"
            >
              <Icon name="palette" size={16} />
            </NavButton>
            <NavButton
              active={view === 'plugins'}
              ariaLabel={t('entry.navExtensions')}
              tooltip={t('entry.navExtensions')}
              onClick={() => selectView('plugins')}
              testId="entry-nav-plugins"
            >
              <Icon name="puzzle" size={16} />
            </NavButton>
            {/* Workspace management (成员 / 数据大盘 / Workspace 设置) lives in
                B's vela/web console — link OUT, don't route to in-client views.
                Gate by B permissions, not workspaceType: a personal workspace
                owner can invite seats and manage the workspace too. */}
            {canManageMembers && workspaceSettingsUrl ? (
              <a
                className="entry-nav-rail__btn"
                href={teamConsoleUrl(workspaceSettingsUrl, 'members')}
                {...externalLinkProps}
                aria-label={t('entry.navMembers')}
                data-tooltip={t('entry.navMembers')}
                data-testid="entry-nav-members"
              >
                <span className="entry-nav-rail__btn-icon" aria-hidden>
                  <Icon name="users" size={16} />
                </span>
                <span className="entry-nav-rail__btn-label">{t('entry.navMembers')}</span>
              </a>
            ) : null}
            {canManageMembers && workspaceSettingsUrl ? (
              <a
                className="entry-nav-rail__btn"
                href={teamConsoleUrl(workspaceSettingsUrl, 'dashboard')}
                {...externalLinkProps}
                aria-label={t('entry.navDashboard')}
                data-tooltip={t('entry.navDashboard')}
                data-testid="entry-nav-dashboard"
              >
                <span className="entry-nav-rail__btn-icon" aria-hidden>
                  <Icon name="dashboard" size={16} />
                </span>
                <span className="entry-nav-rail__btn-label">{t('entry.navDashboard')}</span>
              </a>
            ) : null}
            {canViewWorkspaceSettings && workspaceSettingsUrl ? (
              <a
                className="entry-nav-rail__btn"
                href={workspaceSettingsUrl}
                {...externalLinkProps}
                aria-label={t('entry.navWorkspaceSettings')}
                data-tooltip={t('entry.navWorkspaceSettings')}
                data-testid="entry-nav-workspace-settings"
              >
                <span className="entry-nav-rail__btn-icon" aria-hidden>
                  <Icon name="settings" size={16} />
                </span>
                <span className="entry-nav-rail__btn-label">{t('entry.navWorkspaceSettings')}</span>
              </a>
            ) : null}
          </>
        ) : (
          <>
            <div className="entry-nav-rail__section-divider" aria-hidden />
            <NavButton
              active={view === 'design-systems'}
              ariaLabel={t('entry.navDesignSystems')}
              tooltip={t('entry.navDesignSystems')}
              onClick={() => selectView('design-systems')}
              testId="entry-nav-design-systems"
            >
              <Icon name="palette" size={16} />
            </NavButton>
            <NavButton
              active={view === 'plugins'}
              ariaLabel={t('entry.navExtensions')}
              tooltip={t('entry.navExtensions')}
              onClick={() => selectView('plugins')}
              testId="entry-nav-plugins"
            >
              <Icon name="puzzle" size={16} />
            </NavButton>
          </>
        )}
      </div>
      {/* Skip the footer entirely when it has nothing to show — an empty
          shell here read as a dead white strip under the account row. */}
      {footerNotice || footerExtra ? (
        <div className="entry-nav-rail__footer">
          {footerNotice}
          {footerExtra ? <div className="entry-rail-actions">{footerExtra}</div> : null}
        </div>
      ) : null}
      </div>

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </nav>
  );
}
