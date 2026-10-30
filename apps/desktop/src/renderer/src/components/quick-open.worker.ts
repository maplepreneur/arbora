import { matchFiles, type QuickOpenRequest, type QuickOpenResponse } from './quick-open-match';

/** Holds the project's file list and answers quick-open queries off the UI thread. */
let files: readonly string[] = [];

self.onmessage = (event: MessageEvent<QuickOpenRequest>) => {
  const request = event.data;
  switch (request.type) {
    case 'files':
      files = request.files;
      return;
    case 'query': {
      const response: QuickOpenResponse = {
        id: request.id,
        results: matchFiles(files, request.query, request.recent, request.limit),
      };
      self.postMessage(response);
      return;
    }
    default: {
      const unreachable: never = request;
      throw new Error(`Unknown request ${JSON.stringify(unreachable)}`);
    }
  }
};
