function normalizePlatform(platform, userAgent) {
  const value = `${platform} ${userAgent}`;
  if (/windows/i.test(value)) return 'Windows';
  if (/android/i.test(value)) return 'Android';
  if (/iphone|ipad|ipod|ios/i.test(value)) return 'iOS';
  if (/macintosh|mac os|macintel/i.test(value)) return 'macOS';
  if (/cros|chrome os/i.test(value)) return 'ChromeOS';
  if (/linux/i.test(value)) return 'Linux';
  return 'Not available';
}

function detectBrowser(userAgent) {
  if (/edg(e|a|ios)?\//i.test(userAgent)) return 'Microsoft Edge';
  if (/opr\//i.test(userAgent)) return 'Opera';
  if (/fxios\//i.test(userAgent)) return 'Firefox';
  if (/crios\//i.test(userAgent)) return 'Chrome';
  if (/firefox\//i.test(userAgent)) return 'Firefox';
  if (/chrome\//i.test(userAgent) && !/chromium/i.test(userAgent)) return 'Chrome';
  if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) return 'Safari';
  return 'Browser not identified';
}

export function detectDeviceProfile(navigatorInfo) {
  const userAgent = navigatorInfo.userAgent || '';
  const userAgentData = navigatorInfo.userAgentData;
  const platformHint = userAgentData?.platform || navigatorInfo.platform || '';
  const tabletByTouch = /macintel/i.test(platformHint) && navigatorInfo.maxTouchPoints > 1;
  const tablet = /ipad|tablet/i.test(userAgent) || tabletByTouch;
  const detectedPlatform = tabletByTouch ? 'iPadOS' : platformHint;
  const mobile = typeof userAgentData?.mobile === 'boolean'
    ? userAgentData.mobile || tablet
    : tablet || /android|iphone|ipod|mobile/i.test(userAgent);

  return {
    deviceType: tablet ? 'Tablet' : mobile ? 'Mobile device' : 'Desktop',
    isMobile: mobile,
    browser: detectBrowser(userAgent),
    platform: normalizePlatform(detectedPlatform, userAgent),
  };
}
