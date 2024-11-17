const GITHUB_REPO = "fangyuan99/cookie-share";
const ONE_DAY = 24 * 60 * 60 * 1000; // 24 hours

// 检查更新函数
async function checkForUpdates() {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
    );
    const data = await response.json();

    const currentVersion = chrome.runtime.getManifest().version;
    const latestVersion = data.tag_name.replace("v", "");

    return {
      hasUpdate: latestVersion > currentVersion,
      currentVersion,
      latestVersion,
      releaseUrl: data.html_url,
    };
  } catch (error) {
    console.error("Error checking for updates:", error);
    return {
      hasUpdate: false,
      currentVersion: chrome.runtime.getManifest().version,
      error: error.message,
    };
  }
}

// 自动检查更新（每天一次）
async function autoCheckUpdate() {
  try {
    // 修正 chrome.storage.local.get 的使用方式
    const result = await new Promise((resolve) => {
      chrome.storage.local.get('lastCheckTime', resolve);
    });
    
    const lastCheckTime = result.lastCheckTime || 0;
    const now = Date.now();

    // 果距离上次检查超过24小时，则进行检查
    if (now - lastCheckTime >= ONE_DAY) {
      await checkForUpdates();
      // 更新检查时间
      await new Promise((resolve) => {
        chrome.storage.local.set({ lastCheckTime: now }, resolve);
      });
    }
  } catch (error) {
    console.error("Error in autoCheckUpdate:", error);
  }
}

// 集中处理所有 cookie 相关的操作
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "checkUpdate") {
    checkForUpdates().then(sendResponse);
    return true;
  }

  // 处理发送 cookies
  if (request.action === "sendCookies") {
    // 从 popup 发来的消息需要先获取当前标签页
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        handleSendCookies(request.cookieId, request.customUrl, tabs[0], sendResponse);
      } else {
        sendResponse({ success: false, message: "No active tab found" });
      }
    });
    return true;
  }

  // 处理接收 cookies
  if (request.action === "receiveCookies") {
    // 从 popup 发来的消息需要先获取当前标签页
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        handleReceiveCookies(request.cookieId, request.customUrl, tabs[0], sendResponse);
      } else {
        sendResponse({ success: false, message: "No active tab found" });
      }
    });
    return true;
  }

  // 处理来自 content 的接收 cookies
  if (request.action === "contentReceiveCookies") {
    handleReceiveCookies(request.cookieId, request.customUrl, sender.tab, sendResponse);
    return true;
  }
});

// 处理发送 cookies
async function handleSendCookies(cookieId, customUrl, tab, sendResponse) {
  try {
    const url = new URL(tab.url);
    const cookies = await getAllCookies(url.origin);
    
    // 修改为正确的 cookie 格式
    const cookieData = cookies.map(cookie => ({
      domain: cookie.domain,
      expirationDate: cookie.expirationDate,
      hostOnly: cookie.hostOnly || true,
      httpOnly: cookie.httpOnly,
      name: cookie.name,
      path: cookie.path,
      sameSite: cookie.sameSite.toLowerCase(),
      secure: cookie.secure,
      session: cookie.session || false,
      storeId: null,
      value: cookie.value
    }));

    const response = await fetch(`${customUrl}/send-cookies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cookieId,
        url: tab.url,
        cookies: cookieData,
      }),
    });

    const data = await response.json();
    sendResponse({ success: data.success, message: data.message });
  } catch (error) {
    console.error("Error sending cookies:", error);
    sendResponse({ success: false, message: error.message });
  }
}

// 处理接收 cookies
async function handleReceiveCookies(cookieId, customUrl, tab, sendResponse) {
  try {
    const url = new URL(tab.url);
    
    // 清除现有的 cookies
    await clearAllCookies(url.origin);

    // 获取新的 cookies
    const response = await fetch(`${customUrl}/receive-cookies/${cookieId}`);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message || "Failed to receive cookies");
    }

    // 设置新的 cookies
    await Promise.all(data.cookies.map(cookie => 
      setCookie(url.origin, cookie)
    ));

    // 刷新页面
    chrome.tabs.reload(tab.id);
    
    sendResponse({ success: true });
  } catch (error) {
    console.error("Error receiving cookies:", error);
    sendResponse({ success: false, message: error.message });
  }
}

// Cookie 操作的辅助函数
function getAllCookies(url) {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: new URL(url).hostname }, resolve);
  });
}

function clearAllCookies(url) {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: new URL(url).hostname }, (cookies) => {
      Promise.all(
        cookies.map(cookie =>
          new Promise(resolveDelete => {
            // 使用 cookie 的实际域名和路径来删除
            const cookieUrl = `${cookie.secure ? 'https:' : 'http:'}//${cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain}${cookie.path}`;
            chrome.cookies.remove({
              url: cookieUrl,
              name: cookie.name,
              storeId: cookie.storeId
            }, resolveDelete);
          })
        )
      ).then(resolve);
    });
  });
}

function setCookie(url, cookie) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    chrome.cookies.set(
      {
        url: `${cookie.secure ? "https:" : "http:"}//${urlObj.hostname}${
          cookie.path || "/"
        }`,
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || "/",
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate: cookie.expirationDate,
      },
      (result) => {
        if (chrome.runtime.lastError) {
          console.error("Error setting cookie:", chrome.runtime.lastError);
        }
        resolve(result);
      }
    );
  });
}

// 启动时检查一次
autoCheckUpdate();

// 监听浏览器启动
chrome.runtime.onStartup.addListener(() => {
  autoCheckUpdate();
});
