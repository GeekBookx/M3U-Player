const express = require('express');
const app = express();
const path = require('path');
const port = 3000;

// 托管 public 文件夹下的静态资源
app.use(express.static(path.join(__dirname, 'public')));

// 主页路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`播放器项目已启动: http://localhost:${port}`);
});