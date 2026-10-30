import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('deny list content script', () => {
  describe('when the user navigates to a page that is in the deny list', async () => {
    it("Does not emit any data collection events");
    describe('when the user removes the current host from the deny list', async () => {
      it('The configured collectors are enabled', async () => { });
      it('Does not modify the locally stored collector configuration', async () => { });
    });

    it('The enabled collectors are disabled', async () => { });
  });

  describe('when the user navigates to a page that is not in the deny list', async () => {
    describe('when the user adds the current page to the deny list', async () => {
      it('The enabled collectors are disabled', async () => { });
      it('Does not modify the locally stored collector configuration', async () => { });
    });

    it("Does not disable the configured collectors", async () => { });
  });
});
