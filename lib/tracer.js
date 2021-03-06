// LICENSE_CODE ZON ISC
'use strict'; /*jslint node:true, esnext:true*/
const etask = require('../util/etask.js');
const zdate = require('../util/date.js');
const file = require('../util/file.js');
const zurl = require('../util/url.js');
const puppeteer = require('puppeteer');
const request = require('request').defaults({gzip: true});
const ssl = require('./ssl.js');
const os = require('os');
const zpath = require('path');

const proc_name = 'luminati_proxy_manager';

class Tracer {
    constructor(ws, proxies_running){
        this.ws = ws;
        this.proxies_running = proxies_running;
    }
    trace(url, port){
        const _this = this;
        const log = [];
        return etask(function*tracer_trace(){
            let res, next;
            do {
                _this.ws.broadcast({log, tracing_url: url}, 'tracer');
                res = yield _this.request(url, port);
                if (res.error)
                    return {log, err: true};
                log.push({url, code: res.statusCode});
                next = true;
                if (res.headers&&res.headers.location&&
                    res.headers.location.startsWith('/'))
                {
                    const _url = zurl.parse(url);
                    const domain_url = _url.protocol+'//'+_url.hostname;
                    url = domain_url+res.headers.location;
                }
                else if (res.headers&&res.headers.location)
                    url = res.headers.location;
                else
                    next = false;
            } while (/3../.test(res.statusCode)&&next);
            _this.ws.broadcast({log, tracing_url: null, traced: true},
                'tracer');
            const filename = yield _this.screenshot(url);
            return {log, err: false, filename, loading_page: false};
        });
    }
    request(url, port){
        const opt = {url, method: 'GET', followRedirect: false};
        if (+port)
        {
            opt.proxy = 'http://127.0.0.1:'+port;
            if (this.proxies_running[port].opt.ssl)
                opt.ca = ssl.ca.cert;
            opt.headers = {'x-hola-context': 'PROXY TESTER TOOL'};
        }
        const sp = etask(function*req_stats(){ yield this.wait(); });
        request(opt, (e, http_res)=>{
            if (e)
                sp.return({error: e.message});
            sp.return(http_res);
        });
        return sp;
    }
    screenshot(url){
        const _this = this;
        return etask(function*(){
            const browser = yield puppeteer.launch({
                args: ['--proxy-server=https=127.0.0.1:24000'],
                ignoreHTTPSErrors: true,
            });
            const page = yield browser.newPage();
            let done = false;
            const partial_tasks = etask(function*(){
                yield etask.sleep(500);
                while (!done)
                {
                    const filename = yield _this.make_screenshot(page);
                    _this.ws.broadcast({filename, loading_page: true},
                        'tracer');
                    yield etask.sleep(500);
                }
            });
            const main_task = etask(function*(){
                yield page.goto(url, {timeout: 0});
                done = true;
            });
            yield etask.all([main_task, partial_tasks]);
            const filename = yield _this.make_screenshot(page);
            yield browser.close();
            return filename;
        });
    }
    make_screenshot(page){
        // XXX krzysztof refactor creating and managing directories
        file.mkdirp_e(Tracer.screenshot_dir);
        return etask(function*(){
            const filename = `screenshot_${+zdate()}.png`;
            const path = `${Tracer.screenshot_dir}/${filename}`;
            yield page.screenshot({path});
            return filename;
        });
    }
}

Tracer.screenshot_dir = zpath.resolve(os.homedir(), proc_name+'/screenshots');

module.exports = Tracer;
