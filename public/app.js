let hls = null;
const video = document.getElementById('video');
const errorOverlay = document.getElementById('errorOverlay');
const errorDetail = document.getElementById('errorDetail');
const statusMsg = document.getElementById('statusMsg');
let currentUrl = ""; // 记录当前播放的URL用于重试

// 配置 Hls.js 以优化内存和错误处理
const hlsConfig = {
    autoStartLoad: true,
    startPosition: -1,
    debug: false, // 生产环境关闭Debug以减少控制台输出
    // 致命错误恢复逻辑配置
    manifestLoadingTimeOut: 5000, // 5秒加载超时
    manifestLoadingMaxRetry: 2,   // 最多重试2次
    levelLoadingTimeOut: 5000,
    levelLoadingMaxRetry: 2,
    fragLoadingTimeOut: 5000,
    fragLoadingMaxRetry: 2
};

// 1. 加载资源入口
async function loadSource() {
    const url = document.getElementById('m3uInput').value.trim();
    if (!url) {
        alert("请输入链接");
        return;
    }

    statusMsg.textContent = "正在解析...";
    
    try {
        // 尝试判断是 M3U 列表还是单链接
        // 注意：如果存在跨域(CORS)问题，这里 fetch 可能会失败。
        // 真实项目中通常需要后端做一层 Proxy 转发。
        // 为了演示，假设链接允许跨域，或者用户输入的是 .m3u8 直接播放。
        
        if (url.endsWith('.m3u8')) {
            // 单链接直接播放
            renderSingleChannel(url);
        } else {
            // 尝试作为列表下载解析
            const response = await fetch(url);
            if (!response.ok) throw new Error("网络请求失败");
            const text = await response.text();
            
            if (text.includes('#EXTM3U')) {
                const channels = parseM3U(text);
                renderChannelList(channels);
                if (channels.length > 0) {
                    playChannel(channels[0].url, channels[0].title); // 默认播第一个
                }
            } else {
                // 如果不是标准M3U，尝试直接当做视频流播放
                renderSingleChannel(url);
            }
        }
        statusMsg.textContent = "就绪";
    } catch (e) {
        console.error(e);
        // 如果 fetch 失败（可能是跨域），尝试直接播放（交给 hls.js 处理）
        statusMsg.textContent = "无法解析列表，尝试直接播放...";
        renderSingleChannel(url);
    }
}

// 2. M3U 文本解析器
function parseM3U(content) {
    const lines = content.split('\n');
    const channels = [];
    let currentTitle = "";
    
    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('#EXTINF:')) {
            // 提取标题，格式通常是 #EXTINF:-1,Channel Name
            const info = line.split(',');
            currentTitle = info.length > 1 ? info[1] : "未知频道";
        } else if (line && !line.startsWith('#')) {
            // 这是一行 URL
            channels.push({ title: currentTitle || "未命名", url: line });
            currentTitle = ""; // 重置
        }
    }
    return channels;
}

// 3. 渲染频道列表
function renderChannelList(channels) {
    const list = document.getElementById('channelList');
    list.innerHTML = "";
    
    channels.forEach((ch, index) => {
        const li = document.createElement('li');
        li.textContent = ch.title;
        li.onclick = () => {
            // UI 高亮切换
            document.querySelectorAll('#channelList li').forEach(i => i.classList.remove('active'));
            li.classList.add('active');
            playChannel(ch.url, ch.title);
        };
        list.appendChild(li);
    });
}

function renderSingleChannel(url) {
    const list = document.getElementById('channelList');
    list.innerHTML = `<li class="active" onclick="playChannel('${url}', '单频道')">单频道资源</li>`;
    playChannel(url, "单频道");
}

// 4. 核心播放逻辑 (包含防内存溢出)
function playChannel(url, title) {
    currentUrl = url;
    document.getElementById('currentTitle').textContent = title;
    hideError();

    // 如果已经有 hls 实例，先销毁！非常重要！
    // 这能防止旧的流在后台继续请求数据导致内存增加
    if (hls) {
        hls.destroy();
        hls = null;
    }

    // 检查浏览器是否原生支持 HLS (Safari)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.play().catch(e => handleError("原生播放失败，可能是编码不支持"));
    } else if (Hls.isSupported()) {
        hls = new Hls(hlsConfig);
        
        hls.loadSource(url);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, function() {
            video.play().catch(() => console.log("需要用户交互才能开始播放"));
        });

        // *** 关键：严格的错误监听 ***
        hls.on(Hls.Events.ERROR, function (event, data) {
            // 忽略无关紧要的警告
            if (!data.fatal) return;

            console.warn("HLS Error Details:", data);

            switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                    // 网络错误，尝试恢复一次，如果不行则销毁
                    console.log("网络错误，尝试恢复...");
                    hls.startLoad(); 
                    break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log("媒体错误，尝试恢复...");
                    hls.recoverMediaError();
                    break;
                default:
                    // 无法恢复的错误 (比如 404, 解析失败)
                    stopAndShowError("资源无法加载或已失效");
                    break;
            }
        });
        
        // 额外的层级：如果触发了 destroy 之外的长时间卡顿或死循环，手动监听
        // 这里可以通过监听 buffer 状态来实现更复杂的逻辑
    } else {
        stopAndShowError("您的浏览器不支持 HLS 播放");
    }
}

// 停止播放器并清理内存，显示错误
function stopAndShowError(msg) {
    console.error("致命错误，停止播放器以保护内存:", msg);
    
    if (hls) {
        hls.destroy(); // 彻底销毁实例，停止所有网络请求和解析
        hls = null;
    }
    
    video.removeAttribute('src'); // 清除 Video 标签源
    video.load(); // 重置 video 元素状态
    
    errorDetail.textContent = msg;
    errorOverlay.style.display = 'flex';
}

function handleError(msg) {
    stopAndShowError(msg);
}

function hideError() {
    errorOverlay.style.display = 'none';
}

function retryPlayback() {
    if (currentUrl) {
        playChannel(currentUrl, document.getElementById('currentTitle').textContent);
    }
}