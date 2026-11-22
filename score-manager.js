(function(global) {
    var FIREBASE_DB_URL = 'https://chalbazi-word-default-rtdb.firebaseio.com';
    var CLEAN_BASE = FIREBASE_DB_URL.replace(/\/+$/, '');
    var SCORES_ROOT = CLEAN_BASE + '/chalbaziScores';
    var REFERRALS_ROOT = CLEAN_BASE + '/chalbaziReferrals';
    var SPONSORS_ROOT = CLEAN_BASE + '/chalbaziSponsors';
    var INVITER_BONUS = 50;
    var INVITEE_BONUS = 25;
    var PERSIAN_MONTHS = ['', 'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

    function safeGet(k, fb) { try { return localStorage.getItem(k) || fb; } catch (e) { return fb; } }
    function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function pad2(n) { return n < 10 ? '0' + n : String(n); }

    function toJalali(gy, gm, gd) {
        var g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
        var gy2 = (gm > 2) ? (gy + 1) : gy;
        var days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + g_d_m[gm - 1];
        var jy = -1595 + (33 * Math.floor(days / 12053));
        days %= 12053;
        jy += 4 * Math.floor(days / 1461);
        days %= 1461;
        if (days > 365) {
            jy += Math.floor((days - 1) / 365);
            days = (days - 1) % 365;
        }
        var jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
        var jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
        return { jy: jy, jm: jm, jd: jd };
    }

    function getPeriodKeys() {
        var tehranMs = Date.now() + (210 * 60 * 1000);
        var d = new Date(tehranMs);
        var jToday = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());

        var dow = d.getUTCDay();
        var daysSinceSat = (dow + 1) % 7;
        var satDate = new Date(tehranMs - (daysSinceSat * 86400000));
        var jSat = toJalali(satDate.getUTCFullYear(), satDate.getUTCMonth() + 1, satDate.getUTCDate());

        var dayKey = jToday.jy + '-' + pad2(jToday.jm) + '-' + pad2(jToday.jd);
        var weekKey = 'w_' + jSat.jy + '-' + pad2(jSat.jm) + '-' + pad2(jSat.jd);
        var monthKey = jToday.jy + '-' + pad2(jToday.jm);

        return {
            daily: dayKey,
            weekly: weekKey,
            monthly: monthKey,
            all: 'all',
            labels: {
                daily: 'امروز (' + jToday.jd + ' ' + PERSIAN_MONTHS[jToday.jm] + ')',
                weekly: 'این هفته (از شنبه ' + jSat.jd + ' ' + PERSIAN_MONTHS[jSat.jm] + ')',
                monthly: 'ماه ' + PERSIAN_MONTHS[jToday.jm] + ' ' + jToday.jy,
                all: 'مجموع کل تاریخچه'
            }
        };
    }

    function getQueryParam(name) {
        try {
            var p = new URLSearchParams(window.location.search);
            return p.get(name) || '';
        } catch (e) { return ''; }
    }

    function getUser() {
        var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
        if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) {
            var u = tg.initDataUnsafe.user;
            return {
                id: 'tg_' + u.id,
                rawId: String(u.id),
                name: [u.first_name, u.last_name].filter(Boolean).join(' ') || ('کاربر ' + u.id),
                isTelegram: true
            };
        }
        var qUid = getQueryParam('tg_uid');
        var qName = getQueryParam('tg_name');
        if (qUid) {
            return {
                id: 'tg_' + qUid,
                rawId: String(qUid),
                name: qName || ('کاربر ' + qUid),
                isTelegram: true
            };
        }
        var savedUid = safeGet('chalbazi_uid', '');
        if (!savedUid) {
            savedUid = String(Date.now()).slice(-6) + '_' + Math.floor(Math.random() * 999);
            safeSet('chalbazi_uid', savedUid);
        }
        return {
            id: 'u_' + savedUid,
            rawId: savedUid,
            name: safeGet('chalbazi_guest_name', 'بازیکن چالبازی'),
            isTelegram: false
        };
    }

    function getPeriodUrl(period, keys) {
        if (period === 'all') return SCORES_ROOT + '/all';
        return SCORES_ROOT + '/' + period + '/' + keys[period];
    }

    var writeQueue = Promise.resolve();

    function addScoreForUser(targetId, targetName, points, gameId) {
        var pts = Math.floor(Number(points) || 0);
        if (!targetId || pts <= 0) return Promise.resolve(false);

        writeQueue = writeQueue.then(function() {
            var keys = getPeriodKeys();
            var periods = ['daily', 'weekly', 'monthly', 'all'];
            var tasks = periods.map(function(period) {
                var url = getPeriodUrl(period, keys) + '/' + targetId + '.json';
                return fetch(url)
                    .then(function(r) { return r.ok ? r.json() : null; })
                    .then(function(existing) {
                        var currentScore = (existing && typeof existing.score === 'number') ? existing.score : 0;
                        var gamesObj = (existing && existing.games) ? existing.games : {};
                        if (gameId) {
                            gamesObj[gameId] = (gamesObj[gameId] || 0) + pts;
                        }
                        var finalName = targetName || (existing && existing.name) || 'بازیکن چالبازی';
                        return fetch(url, {
                            method: 'PUT',
                            body: JSON.stringify({
                                name: finalName,
                                score: currentScore + pts,
                                games: gamesObj,
                                updatedAt: Date.now()
                            })
                        });
                    })
                    .catch(function() {});
            });
            return Promise.all(tasks);
        }).catch(function() {});

        return writeQueue;
    }

    function addScore(points, gameId, eventId) {
        var pts = Math.floor(Number(points) || 0);
        if (pts <= 0) return Promise.resolve(false);

        var user = getUser();
        if (eventId) {
            var dedupeKey = 'cs_evt_' + user.id + '_' + eventId;
            if (safeGet(dedupeKey, '') === '1') return Promise.resolve(false);
            safeSet(dedupeKey, '1');
        }

        return addScoreForUser(user.id, user.name, pts, gameId);
    }

    function getMyStats() {
        var user = getUser();
        var keys = getPeriodKeys();
        var periods = ['daily', 'weekly', 'monthly', 'all'];
        var result = { daily: 0, weekly: 0, monthly: 0, all: 0, labels: keys.labels };

        var tasks = periods.map(function(period) {
            var url = getPeriodUrl(period, keys) + '/' + user.id + '.json';
            return fetch(url)
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (data && typeof data.score === 'number') {
                        result[period] = data.score;
                    }
                })
                .catch(function() {});
        });

        return Promise.all(tasks).then(function() { return result; });
    }

    function getLeaderboard(period, limit) {
        var lim = limit || 20;
        var user = getUser();
        var keys = getPeriodKeys();
        var url = getPeriodUrl(period, keys) + '.json';

        return fetch(url)
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(data) {
                var list = [];
                if (data) {
                    var ids = Object.keys(data);
                    for (var i = 0; i < ids.length; i++) {
                        var id = ids[i];
                        var item = data[id];
                        if (item && typeof item.score === 'number' && item.score > 0) {
                            list.push({
                                id: id,
                                name: item.name || 'بازیکن',
                                score: item.score,
                                isMe: id === user.id
                            });
                        }
                    }
                }
                list.sort(function(a, b) { return b.score - a.score; });

                var myRank = 0;
                var myScore = 0;
                for (var j = 0; j < list.length; j++) {
                    if (list[j].id === user.id) {
                        myRank = j + 1;
                        myScore = list[j].score;
                        break;
                    }
                }

                return {
                    period: period,
                    label: keys.labels[period],
                    top: list.slice(0, lim),
                    totalPlayers: list.length,
                    myRank: myRank,
                    myScore: myScore
                };
            })
            .catch(function() {
                return { period: period, label: keys.labels[period], top: [], totalPlayers: 0, myRank: 0, myScore: 0, error: true };
            });
    }

    // ==================== سیستم دعوت دوستان (Referral) ====================
    function syncMyReferralProfile() {
        var user = getUser();
        if (!user.isTelegram) return Promise.resolve();
        return fetch(REFERRALS_ROOT + '/users/' + user.id + '.json', {
            method: 'PATCH',
            body: JSON.stringify({ name: user.name, updatedAt: Date.now() })
        }).catch(function() {});
    }

    function getReferralInfo() {
        var user = getUser();
        return fetch(REFERRALS_ROOT + '/users/' + user.id + '.json')
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(data) {
                var invitedList = [];
                if (data && data.invited) {
                    var keys = Object.keys(data.invited);
                    for (var i = 0; i < keys.length; i++) {
                        var item = data.invited[keys[i]];
                        if (item) {
                            invitedList.push({
                                id: keys[i],
                                name: item.name || 'بازیکن',
                                ts: item.ts || 0
                            });
                        }
                    }
                    invitedList.sort(function(a, b) { return b.ts - a.ts; });
                }
                return {
                    count: (data && typeof data.count === 'number') ? data.count : invitedList.length,
                    totalEarned: (data && typeof data.totalEarned === 'number') ? data.totalEarned : (invitedList.length * INVITER_BONUS),
                    invitedList: invitedList
                };
            })
            .catch(function() {
                return { count: 0, totalEarned: 0, invitedList: [] };
            });
    }

    function processReferral(refRawId) {
        var user = getUser();
        var cleanRef = String(refRawId || '').replace(/[^0-9]/g, '');
        if (!cleanRef) return Promise.resolve({ status: 'invalid' });
        if (!user.isTelegram) return Promise.resolve({ status: 'guest_blocked' });

        var inviterId = 'tg_' + cleanRef;
        if (inviterId === user.id) return Promise.resolve({ status: 'self' });

        var claimUrl = REFERRALS_ROOT + '/claimed/' + user.id + '.json';
        return fetch(claimUrl)
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(claimedData) {
                if (claimedData && claimedData.by) {
                    return { status: 'already_claimed' };
                }

                return fetch(claimUrl, {
                    method: 'PUT',
                    body: JSON.stringify({
                        by: inviterId,
                        name: user.name,
                        ts: Date.now()
                    })
                }).then(function() {
                    return Promise.all([
                        fetch(REFERRALS_ROOT + '/users/' + inviterId + '.json').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
                        fetch(SCORES_ROOT + '/all/' + inviterId + '.json').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
                    ]);
                }).then(function(results) {
                    var refUser = results[0] || {};
                    var scoreUser = results[1] || {};
                    var inviterName = refUser.name || scoreUser.name || ('بازیکن ' + cleanRef);
                    var prevInvited = refUser.invited || {};
                    prevInvited[user.id] = { name: user.name, ts: Date.now() };
                    var newCount = Object.keys(prevInvited).length;
                    var newEarned = newCount * INVITER_BONUS;

                    var updateInviterNode = fetch(REFERRALS_ROOT + '/users/' + inviterId + '.json', {
                        method: 'PUT',
                        body: JSON.stringify({
                            name: inviterName,
                            count: newCount,
                            totalEarned: newEarned,
                            invited: prevInvited,
                            updatedAt: Date.now()
                        })
                    }).catch(function() {});

                    var rewardInviter = addScoreForUser(inviterId, inviterName, INVITER_BONUS, 'referral');
                    var rewardInvitee = addScore(INVITEE_BONUS, 'referral_welcome', 'welcome_' + user.id);

                    return Promise.all([updateInviterNode, rewardInviter, rewardInvitee]).then(function() {
                        return { status: 'success', inviterName: inviterName, bonus: INVITEE_BONUS };
                    });
                });
            })
            .catch(function() {
                return { status: 'error' };
            });
    }

    // ==================== سیستم ماموریت‌های اسپانسری و بنر ====================
    function getSponsorData() {
        var user = getUser();
        return Promise.all([
            fetch(SPONSORS_ROOT + '/tasks.json').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
            fetch(SPONSORS_ROOT + '/banner.json').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; }),
            fetch(SPONSORS_ROOT + '/claims/' + user.id + '.json').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
        ]).then(function(res) {
            var tasksObj = res[0] || {};
            var banner = res[1] || null;
            var claimedMap = res[2] || {};
            var tasksList = [];

            var keys = Object.keys(tasksObj);
            for (var i = 0; i < keys.length; i++) {
                var t = tasksObj[keys[i]];
                if (t && t.title && t.url) {
                    tasksList.push({
                        id: keys[i],
                        title: t.title,
                        desc: t.desc || '',
                        url: t.url,
                        reward: Number(t.reward) || 30,
                        icon: t.icon || '📢',
                        active: t.active !== false,
                        claimsCount: Number(t.claimsCount) || 0,
                        createdAt: t.createdAt || 0
                    });
                }
            }
            tasksList.sort(function(a, b) { return b.createdAt - a.createdAt; });

            return {
                banner: banner,
                tasks: tasksList,
                claimedMap: claimedMap
            };
        }).catch(function() {
            return { banner: null, tasks: [], claimedMap: {} };
        });
    }

    function claimSponsorTask(taskId) {
        var user = getUser();
        if (!user.isTelegram) return Promise.resolve({ status: 'guest_blocked' });
        if (!taskId) return Promise.resolve({ status: 'invalid' });

        var claimUrl = SPONSORS_ROOT + '/claims/' + user.id + '/' + taskId + '.json';
        var taskUrl = SPONSORS_ROOT + '/tasks/' + taskId + '.json';

        return Promise.all([
            fetch(claimUrl).then(function(r) { return r.ok ? r.json() : null; }),
            fetch(taskUrl).then(function(r) { return r.ok ? r.json() : null; })
        ]).then(function(res) {
            var existingClaim = res[0];
            var task = res[1];

            if (existingClaim && existingClaim.ts) return { status: 'already_claimed' };
            if (!task || task.active === false) return { status: 'not_found' };

            var reward = Math.max(1, Math.floor(Number(task.reward) || 30));
            var newClaimsCount = (Number(task.claimsCount) || 0) + 1;

            return Promise.all([
                fetch(claimUrl, {
                    method: 'PUT',
                    body: JSON.stringify({ ts: Date.now(), reward: reward, name: user.name })
                }),
                fetch(taskUrl, {
                    method: 'PATCH',
                    body: JSON.stringify({ claimsCount: newClaimsCount })
                }),
                addScore(reward, 'sponsor_task', 'sptask_' + taskId)
            ]).then(function() {
                return { status: 'success', reward: reward };
            });
        }).catch(function() {
            return { status: 'error' };
        });
    }

    function trackBannerClick() {
        var url = SPONSORS_ROOT + '/banner.json';
        return fetch(url)
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(b) {
                if (!b) return;
                var clicks = (Number(b.clicks) || 0) + 1;
                return fetch(url, {
                    method: 'PATCH',
                    body: JSON.stringify({ clicks: clicks })
                });
            })
            .catch(function() {});
    }

    function saveSponsorTask(task) {
        var id = task.id || ('t_' + Date.now());
        var payload = {
            id: id,
            title: String(task.title || '').trim(),
            desc: String(task.desc || '').trim(),
            url: String(task.url || '').trim(),
            reward: Math.max(5, Math.floor(Number(task.reward) || 30)),
            icon: String(task.icon || '📢').trim() || '📢',
            active: task.active !== false,
            claimsCount: Number(task.claimsCount) || 0,
            createdAt: task.createdAt || Date.now()
        };
        return fetch(SPONSORS_ROOT + '/tasks/' + id + '.json', {
            method: 'PUT',
            body: JSON.stringify(payload)
        }).then(function(r) { return r.ok; }).catch(function() { return false; });
    }

    function deleteSponsorTask(taskId) {
        return fetch(SPONSORS_ROOT + '/tasks/' + taskId + '.json', {
            method: 'DELETE'
        }).then(function(r) { return r.ok; }).catch(function() { return false; });
    }

    function saveSponsorBanner(bannerObj) {
        var payload = {
            active: !!bannerObj.active,
            title: String(bannerObj.title || '').trim(),
            desc: String(bannerObj.desc || '').trim(),
            url: String(bannerObj.url || '').trim(),
            btnText: String(bannerObj.btnText || 'مشاهده ↗').trim() || 'مشاهده ↗',
            clicks: Number(bannerObj.clicks) || 0,
            updatedAt: Date.now()
        };
        return fetch(SPONSORS_ROOT + '/banner.json', {
            method: 'PUT',
            body: JSON.stringify(payload)
        }).then(function(r) { return r.ok; }).catch(function() { return false; });
    }

    global.ChalbaziScore = {
        INVITER_BONUS: INVITER_BONUS,
        INVITEE_BONUS: INVITEE_BONUS,
        getUser: getUser,
        getPeriodKeys: getPeriodKeys,
        addScore: addScore,
        getMyStats: getMyStats,
        getLeaderboard: getLeaderboard,
        syncMyReferralProfile: syncMyReferralProfile,
        getReferralInfo: getReferralInfo,
        processReferral: processReferral,
        getSponsorData: getSponsorData,
        claimSponsorTask: claimSponsorTask,
        trackBannerClick: trackBannerClick,
        saveSponsorTask: saveSponsorTask,
        deleteSponsorTask: deleteSponsorTask,
        saveSponsorBanner: saveSponsorBanner
    };
})(window);
