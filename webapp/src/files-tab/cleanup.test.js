// Tests for webapp/src/files-tab.js — disconnect cleanup.
// Pins that window listeners are removed when the tab
// unmounts, so files-modified events stop triggering
// reloads.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  mountTab,
  publishFakeRpc,
  settle,
  fakeTreeResponse,
  pushEvent,
  installCleanup,
} from './test-helpers.js';

installCleanup();

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe('FilesTab cleanup', () => {
  it('removes window listeners on disconnect', async () => {
    const getTree = vi
      .fn()
      .mockResolvedValue(fakeTreeResponse([]));
    publishFakeRpc({ 'Repo.get_file_tree': getTree });
    const t = mountTab();
    await settle(t);
    expect(getTree).toHaveBeenCalledTimes(1);
    t.remove();
    // After disconnect, files-modified events must not
    // trigger a reload.
    pushEvent('files-modified', {});
    await new Promise((r) => setTimeout(r, 10));
    expect(getTree).toHaveBeenCalledTimes(1);
  });
});