import { MAX_FILE_BYTES, rejectReason } from '../accountImport/validate';

describe('screenshot file validation', () => {
  it('accepts normal screenshots', () => {
    expect(rejectReason({ name: 'dash.png', type: 'image/png', bytes: 300_000, width: 1280, height: 800 })).toBeNull();
    expect(rejectReason({ name: 'photo.jpg', bytes: 2_000_000, width: 3024, height: 4032 })).toBeNull();
  });
  it('rejects unsupported types', () => {
    expect(rejectReason({ name: 'statement.pdf', type: 'application/pdf' })).toMatch(/not supported/);
    expect(rejectReason({ name: 'anim.gif', type: 'image/gif' })).toMatch(/not supported/);
    expect(rejectReason({ name: 'notes.txt', type: 'text/plain' })).toMatch(/not supported/);
    // Unknown type with no extension is left to the decoder (which reports corrupt files).
    expect(rejectReason({ name: 'Camera capture', width: 1200, height: 900 })).toBeNull();
  });
  it('rejects oversized, empty, corrupted, huge or tiny images', () => {
    expect(rejectReason({ name: 'a.png', type: 'image/png', bytes: MAX_FILE_BYTES + 1 })).toMatch(/15 MB/);
    expect(rejectReason({ name: 'a.png', type: 'image/png', bytes: 0 })).toMatch(/empty/);
    expect(rejectReason({ name: 'a.png', type: 'image/png', width: 0, height: 0 })).toMatch(/could not be opened/);
    expect(rejectReason({ name: 'a.png', type: 'image/png', width: 10000, height: 8000 })).toMatch(/too large/);
    expect(rejectReason({ name: 'a.png', type: 'image/png', width: 120, height: 90 })).toMatch(/too small/);
  });
});
