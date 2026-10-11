import { router } from 'expo-router';

import { goBack } from '../navigation';

jest.mock('expo-router', () => ({ router: { canGoBack: jest.fn(), back: jest.fn(), replace: jest.fn() } }));

const r = router as unknown as { canGoBack: jest.Mock; back: jest.Mock; replace: jest.Mock };

describe('goBack', () => {
  beforeEach(() => jest.clearAllMocks());

  it('goes back when there is history', () => {
    r.canGoBack.mockReturnValue(true);
    goBack('/accounts');
    expect(r.back).toHaveBeenCalled();
    expect(r.replace).not.toHaveBeenCalled();
  });

  it('opens the fallback screen when the screen was opened directly', () => {
    r.canGoBack.mockReturnValue(false);
    goBack('/accounts');
    expect(r.back).not.toHaveBeenCalled();
    expect(r.replace).toHaveBeenCalledWith('/accounts');
  });
});
