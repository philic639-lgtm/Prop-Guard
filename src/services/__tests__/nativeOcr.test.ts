/**
 * iOS / Android OCR adapter (`ocr.ts`): the picked photo is re-encoded on the device
 * (HEIC → JPEG, very large camera photos reduced) and handed to the hidden WebView reader
 * as a data: URL; failures are typed. The WebView itself is replaced by the bridge.
 */
import { attachHost, onHostMessage, __resetBridge } from '../accountImport/webview/bridge';
import { ocrAvailable, recognize, redactImage } from '../accountImport/ocr';

const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: (uri: string) => mockManipulate(uri) },
}));

function fakeContext(saved: { base64?: string; width: number; height: number } | Error) {
  const resize = jest.fn();
  const saveAsync = jest.fn(() => (saved instanceof Error ? Promise.reject(saved) : Promise.resolve({ uri: 'file://x.jpg', ...saved })));
  mockManipulate.mockReturnValue({ resize, renderAsync: () => Promise.resolve({ saveAsync }) });
  return { resize, saveAsync };
}

/** A page that answers every request with `answer(req)`. */
function page(answer: (req: { id: number; op: string; image?: { uri: string } }) => unknown) {
  const sent: { id: number; op: string; image?: { uri: string } }[] = [];
  attachHost((m) => {
    const req = JSON.parse(m);
    sent.push(req);
    setTimeout(() => onHostMessage(JSON.stringify({ id: req.id, ok: true, result: answer(req) })), 0);
  });
  onHostMessage(JSON.stringify({ ready: true }));
  return sent;
}

const img = (o: Partial<{ id: string; uri: string; width: number; height: number }> = {}) => ({ id: 'a', uri: 'file://IMG_0001.HEIC', name: 'IMG_0001.HEIC', width: 1179, height: 2556, ...o });

describe('native screenshot reader adapter', () => {
  beforeEach(() => {
    __resetBridge();
    mockManipulate.mockReset();
  });

  it('is available only while the import screen hosts the reader', () => {
    expect(ocrAvailable()).toBe(false);
    page(() => null);
    expect(ocrAvailable()).toBe(true);
  });

  it('re-encodes the photo to JPEG on the device and sends it as a data: URL (phone screenshots keep their size)', async () => {
    const ctx = fakeContext({ base64: 'QUJD', width: 1179, height: 2556 });
    const sent = page(() => ({ width: 1179, height: 2556, confidence: 90, lines: [] }));
    const result = await recognize(img());
    expect(mockManipulate).toHaveBeenCalledWith('file://IMG_0001.HEIC');
    expect(ctx.resize).not.toHaveBeenCalled();
    expect(ctx.saveAsync).toHaveBeenCalledWith(expect.objectContaining({ format: 'jpeg', base64: true }));
    expect(sent[0]).toMatchObject({ op: 'recognize', image: { uri: 'data:image/jpeg;base64,QUJD' } });
    expect(result).toMatchObject({ confidence: 90 });
  });

  it('reduces very large camera photos (8 MP budget, aspect kept)', async () => {
    const ctx = fakeContext({ base64: 'QUJD', width: 2449, height: 3265 });
    page(() => ({ width: 1800, height: 2400, confidence: 80, lines: [] }));
    await recognize(img({ id: 'b', width: 3024, height: 4032 }));
    expect(ctx.resize).toHaveBeenCalledWith({ width: Math.round(3024 * Math.sqrt(8_000_000 / (3024 * 4032))) });
  });

  it('an image the device cannot decode fails as image_failed — never a guessed reading', async () => {
    fakeContext(new Error('unsupported'));
    page(() => null);
    await expect(recognize(img({ id: 'c' }))).rejects.toMatchObject({ code: 'image_failed' });
  });

  it('redaction for the advanced reader uses the same prepared image (boxes line up)', async () => {
    fakeContext({ base64: 'QUJD', width: 1179, height: 2556 });
    const sent = page((req) => (req.op === 'redact' ? { uri: 'data:image/jpeg;base64,UkVE', base64: 'UkVE' } : { width: 1179, height: 2556, confidence: 90, lines: [] }));
    await recognize(img({ id: 'd' }));
    const r = await redactImage(img({ id: 'd' }), [{ x0: 1, y0: 2, x1: 3, y1: 4 }]);
    expect(r).toEqual({ uri: 'data:image/jpeg;base64,UkVE', base64: 'UkVE' });
    expect(mockManipulate).toHaveBeenCalledTimes(1); // prepared once, reused
    expect(sent[1]).toMatchObject({ op: 'redact', boxes: [{ x0: 1, y0: 2, x1: 3, y1: 4 }], image: { uri: 'data:image/jpeg;base64,QUJD' } });
  });

  it('without the reader open, redaction is unavailable (the advanced reader then explains why)', async () => {
    expect(await redactImage(img({ id: 'e' }), [])).toBeNull();
  });
});
