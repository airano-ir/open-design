// Integrations → Agent plugin panel.
//
// Lists the coding-agent hosts the Open Design agent plugin installs into
// (codex / claude / cursor) with one-click install/uninstall, plus the
// ChatCut-style single-line prompt a user can paste into any agent to
// have IT self-install from the landing page. The daemon twin is
// /api/agent-plugin/* and the terminal twin is `od agent-plugin`.

import { useEffect, useRef, useState } from 'react';
import { Button } from '@open-design/components';
import {
  fetchAgentPluginHosts,
  installAgentPlugin,
  uninstallAgentPlugin,
} from '../state/agent-plugin';
import type {
  AgentPluginHostSlug,
  AgentPluginHostsResponse,
  AgentPluginInstallResult,
} from '../state/agent-plugin';
import { useT } from '../i18n';
import styles from './AgentPluginSection.module.css';

// The GitHub URL (not open-design.ai/chatgpt) so the prompt works even
// before a landing-page deploy — the blob page serves the same canonical
// plugins/open-design/INSTALL.md runbook the /chatgpt route inlines.
export const AGENT_PLUGIN_INSTALL_PROMPT =
  'Read https://github.com/nexu-io/open-design/blob/main/plugins/open-design/INSTALL.md to install the Open Design plugin and set up a new design task for me.';

type HostBusy = 'install' | 'uninstall' | null;

export function AgentPluginSection() {
  const t = useT();
  const [hosts, setHosts] = useState<AgentPluginHostsResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<Partial<Record<AgentPluginHostSlug, HostBusy>>>({});
  const [results, setResults] = useState<
    Partial<Record<AgentPluginHostSlug, AgentPluginInstallResult>>
  >({});
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAgentPluginHosts().then((data) => {
      if (cancelled) return;
      if (data) setHosts(data);
      else setLoadFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AGENT_PLUGIN_INSTALL_PROMPT);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the text stays selectable */
    }
  };

  const runAction = async (slug: AgentPluginHostSlug, action: 'install' | 'uninstall') => {
    setBusy((prev) => ({ ...prev, [slug]: action }));
    const result =
      action === 'install' ? await installAgentPlugin(slug) : await uninstallAgentPlugin(slug);
    setBusy((prev) => ({ ...prev, [slug]: null }));
    setResults((prev) => ({
      ...prev,
      [slug]: result ?? {
        ok: false,
        host: slug,
        strategy: 'manual',
        message: t('agentPlugin.requestFailed'),
        performed: [],
      },
    }));
  };

  return (
    <section className={styles.section} aria-label={t('integrations.tabLabel.agentPlugin')}>
      <p className={styles.lede}>{t('agentPlugin.lede')}</p>

      <div className={styles.promptCard}>
        <code className={styles.promptText} data-testid="agent-plugin-install-prompt">
          {AGENT_PLUGIN_INSTALL_PROMPT}
        </code>
        <Button variant="primary" onClick={() => void copyPrompt()}>
          {copied ? t('agentPlugin.copied') : t('agentPlugin.copy')}
        </Button>
      </div>

      {loadFailed ? <p className={styles.loadError}>{t('agentPlugin.loadFailed')}</p> : null}

      {hosts ? (
        <>
          <p className={styles.bundleMeta}>
            {t('agentPlugin.bundleMeta', {
              version: hosts.bundle.version ?? '—',
              count: hosts.bundle.skills.length,
            })}
          </p>
          <div className={styles.hostGrid}>
            {hosts.hosts.map((host) => {
              const hostBusy = busy[host.slug] ?? null;
              const result = results[host.slug];
              return (
                <article key={host.slug} className={styles.hostCard} data-testid={`agent-plugin-host-${host.slug}`}>
                  <div className={styles.hostHead}>
                    <h3 className={styles.hostName}>{host.label}</h3>
                    <span
                      className={
                        host.binDetected
                          ? `${styles.hostBadge} ${styles.hostBadgeDetected}`
                          : styles.hostBadge
                      }
                    >
                      {host.binDetected
                        ? t('agentPlugin.hostDetected')
                        : t('agentPlugin.hostMissing')}
                    </span>
                  </div>
                  <p className={styles.hostBrowser}>
                    {t('agentPlugin.browserVerify', { browser: host.browser })}
                  </p>
                  <pre className={styles.commands}>{host.installPreview.join('\n')}</pre>
                  <div className={styles.hostActions}>
                    <Button
                      variant="primary"
                      disabled={hostBusy != null}
                      onClick={() => void runAction(host.slug, 'install')}
                    >
                      {hostBusy === 'install'
                        ? t('agentPlugin.installing')
                        : t('agentPlugin.install')}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={hostBusy != null}
                      onClick={() => void runAction(host.slug, 'uninstall')}
                    >
                      {hostBusy === 'uninstall'
                        ? t('agentPlugin.uninstalling')
                        : t('agentPlugin.uninstall')}
                    </Button>
                  </div>
                  {result ? (
                    <p className={result.ok ? styles.resultOk : styles.resultErr}>
                      {result.message}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}
