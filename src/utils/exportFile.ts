import { Platform, Share } from 'react-native';

/**
 * Hands an export to the trader: a file download on web (the Web Share API is missing in most
 * desktop browsers), the system share sheet on iOS / Android.
 */
export async function shareOrDownload(filename: string, mime: string, text: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  await Share.share({ title: filename, message: text });
}
