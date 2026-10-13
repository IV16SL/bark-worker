export default {
    async fetch(request, env, ctx) {
        return await handleRequest(request, env, ctx)
    }
}

async function handleRequest(request, env, ctx) {
    const allowNewDevice = env.ALLOW_NEW_DEVICE !== undefined ? (env.ALLOW_NEW_DEVICE === 'false' ? false : Boolean(env.ALLOW_NEW_DEVICE)) : true
    const allowQueryNums = env.ALLOW_QUERY_NUMS !== undefined ? (env.ALLOW_QUERY_NUMS === 'false' ? false : Boolean(env.ALLOW_QUERY_NUMS)) : true
    let rootPrefix = env.ROOT_PATH || '/'
    while (rootPrefix.length > 1 && rootPrefix.endsWith('/')) {
        rootPrefix = rootPrefix.slice(0, -1)
    }
    if (rootPrefix === '/') {
        rootPrefix = ''
    }
    const basicAuth = env.BASIC_AUTH

    const db = new Database(env)
    // Session cleanup is a D1 write; run it probabilistically instead of on every request
    if (Math.random() < 0.01) {
        ctx.waitUntil(db.cleanupExpiredSessions())
    }

    const { searchParams, pathname } = new URL(request.url)
    const handler = new Handler(db, { allowNewDevice, allowQueryNums })
    // boundary-aware prefix strip: '/api' must not match '/apiary/...' (same as bark-server's route group)
    const realPathname = rootPrefix
        ? ((pathname === rootPrefix || pathname.startsWith(rootPrefix + '/')) ? (pathname.slice(rootPrefix.length) || '/') : pathname)
        : pathname

    switch (realPathname) {
        case '/register': {
            return handler.register(searchParams)
        }
        case '/ping': {
            return handler.ping(searchParams)
        }
        case '/healthz': {
            return handler.healthz(searchParams)
        }
        case '/info': {
            if (!util.validateBasicAuth(request, basicAuth)) {
                return new Response('Unauthorized', {
                    status: 401,
                    headers: {
                        'content-type': 'text/plain',
                        'WWW-Authenticate': 'Basic realm="Bark"',
                    }
                })
            }
            return handler.info(searchParams)
        }
        case '/mcp': {
            if (!util.validateBasicAuth(request, basicAuth)) {
                return new Response('Unauthorized', {
                    status: 401,
                    headers: {
                        'content-type': 'text/plain',
                        'WWW-Authenticate': 'Basic realm="Bark"',
                    }
                })
            }
            return handler.mcp(request, undefined)
        }
        default: {
            const pathParts = realPathname.split('/')

            if (pathParts[1]) {
                if (!util.validateBasicAuth(request, basicAuth)) {
                    return new Response('Unauthorized', {
                        status: 401,
                        headers: {
                            'content-type': 'text/plain',
                            'WWW-Authenticate': 'Basic',
                        }
                    })
                }

                if (pathParts[1] === 'mcp') {
                    return handler.mcp(request, pathParts[2])
                }

                const contentType = request.headers.get('content-type')
                let requestBody = {}

                try {
                    if (contentType && (contentType.includes('application/json') || contentType.includes('+json'))) {
                        requestBody = await request.json()

                        requestBody = Object.keys(requestBody).reduce((obj, key) => {
                            obj[key.toLowerCase()] = requestBody[key]
                            return obj
                        }, {})

                        // query args: medium priority (same as bark-server V2)
                        searchParams.forEach((value, key) => { requestBody[key.toLowerCase()] = value })

                        // url path params: highest priority (same as bark-server V2)
                        const jsonPathParams = decodedPathParams(pathParts)
                        if (jsonPathParams === null) {
                            return segmentLimitResponse(request, realPathname)
                        }
                        Object.assign(requestBody, jsonPathParams)
                    } else if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
                        // query args: medium priority (same as bark-server V1)
                        searchParams.forEach((value, key) => { requestBody[key.toLowerCase()] = value })

                        const formData = await request.formData()
                        formData.forEach((value, key) => { requestBody[key.toLowerCase()] = value })

                        // url path params: highest priority (same as bark-server V1)
                        // (kept percent-encoded here; the decode block below handles them once)
                        const formPathParams = rawPathParams(pathParts)
                        if (formPathParams === null) {
                            return segmentLimitResponse(request, realPathname)
                        }
                        Object.assign(requestBody, formPathParams)

                        try {
                            if (requestBody.title) {
                                requestBody.title = decodeURIComponent(requestBody.title.replaceAll('+', '%20'))
                            }

                            if (requestBody.subtitle) {
                                requestBody.subtitle = decodeURIComponent(requestBody.subtitle.replaceAll('+', '%20'))
                            }

                            if (requestBody.body) {
                                requestBody.body = decodeURIComponent(requestBody.body.replaceAll('+', '%20'))
                            }

                            if (requestBody.markdown) {
                                requestBody.markdown = decodeURIComponent(requestBody.markdown.replaceAll('+', '%20'))
                            }
                        } catch (error) {
                            return new Response(JSON.stringify({
                                'code': 500,
                                'message': `url path parse failed: ${error}`,
                                'timestamp': util.getTimestamp(),
                            }), {
                                status: 500,
                                headers: {
                                    'content-type': 'application/json',
                                }
                            })
                        }
                    } else {
                        searchParams.forEach((value, key) => { requestBody[key.toLowerCase()] = value })

                        const getPathParams = rawPathParams(pathParts)
                        if (getPathParams === null) {
                            return segmentLimitResponse(request, realPathname)
                        }
                        Object.assign(requestBody, getPathParams)

                        try {
                            if (requestBody.title) {
                                requestBody.title = decodeURIComponent(requestBody.title.replaceAll('+', '%20'))
                            }

                            if (requestBody.subtitle) {
                                requestBody.subtitle = decodeURIComponent(requestBody.subtitle.replaceAll('+', '%20'))
                            }

                            if (requestBody.body) {
                                requestBody.body = decodeURIComponent(requestBody.body.replaceAll('+', '%20'))
                            }

                            if (requestBody.markdown) {
                                requestBody.markdown = decodeURIComponent(requestBody.markdown.replaceAll('+', '%20'))
                            }
                        } catch (error) {
                            return new Response(JSON.stringify({
                                'code': 500,
                                'message': `url path parse failed: ${error}`,
                                'timestamp': util.getTimestamp(),
                            }), {
                                status: 500,
                                headers: {
                                    'content-type': 'application/json',
                                }
                            })
                        }
                    }

                    if (requestBody.device_keys && typeof requestBody.device_keys === 'string') {
                        const deviceKeysRaw = requestBody.device_keys.trim()

                        if (deviceKeysRaw.startsWith('[') && deviceKeysRaw.endsWith(']')) {
                            try {
                                requestBody.device_keys = JSON.parse(deviceKeysRaw)
                            } catch {
                                requestBody.device_keys = [requestBody.device_keys]
                            }
                        } else {
                            requestBody.device_keys = decodeURIComponent(deviceKeysRaw).split(',').map(item => item.replace(/['"]/g, '').trim())
                        }

                        if (typeof requestBody.device_keys === 'string') {
                            requestBody.device_keys = [requestBody.device_keys]
                        }
                    }
                } catch (error) {
                    return new Response(JSON.stringify({
                        'code': 400,
                        'message': `request bind failed: ${error}`,
                        'timestamp': util.getTimestamp(),
                    }), {
                        status: 400,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }

                if (requestBody.device_keys && requestBody.device_keys.length > 0) {
                    return new Response(JSON.stringify({
                        'code': 200,
                        'message': 'success',
                        'data': await Promise.all(requestBody.device_keys.map(async (device_key) => {
                            try {
                                if (!device_key) {
                                    return {
                                        code: 400,
                                        message: 'device key is empty',
                                        device_key: device_key,
                                    }
                                }

                                const response = await handler.push({ ...requestBody, device_key })
                                const responseBody = await response.json()
                                return {
                                    code: response.status,
                                    message: responseBody.message,
                                    device_key: device_key,
                                }
                            } catch (err) {
                                // isolate per-device failures so one bad push
                                // doesn't fail the whole batch (same as bark-server)
                                return {
                                    code: 500,
                                    message: `push failed: ${err}`,
                                    device_key: device_key,
                                }
                            }
                        })),
                        'timestamp': util.getTimestamp(),
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }

                if (realPathname != '/push') {
                    requestBody.device_key = pathParts[1]
                }

                if (!requestBody.device_key) {
                    return new Response(JSON.stringify({
                        'code': 400,
                        'message': 'device key is empty',
                        'timestamp': util.getTimestamp(),
                    }), {
                        status: 400,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }

                return handler.push(requestBody)
            }

            if (realPathname === '/') {
                return new Response('ok', {
                    status: 200,
                    headers: {
                        'content-type': 'text/plain',
                    }
                })
            }

            return new Response(JSON.stringify({
                'code': 404,
                'message': `Cannot ${request.method} ${realPathname}`,
                'timestamp': util.getTimestamp(),
            }), {
                status: 404,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }
    }
}

// Decode one URL path segment ('+' counts as space, then percent-decoding)
function decodePathSegment(value) {
    return decodeURIComponent(String(value).replaceAll('+', '%20'))
}

// Raw (still percent-encoded) path params for
// /:device_key/[:body | :title/:body | :title/:subtitle/:body]
// Returns null when there are too many segments.
function rawPathParams(pathParts) {
    if (pathParts.length === 3) {
        return { body: pathParts[2] }
    } else if (pathParts.length === 4) {
        return { title: pathParts[2], body: pathParts[3] }
    } else if (pathParts.length === 5) {
        return { title: pathParts[2], subtitle: pathParts[3], body: pathParts[4] }
    } else if (pathParts.length > 5) {
        return null
    }
    return {}
}

// Decoded path params, for request types whose other params are not decoded afterwards (JSON)
function decodedPathParams(pathParts) {
    const raw = rawPathParams(pathParts)
    if (raw === null) {
        return null
    }
    const decoded = {}
    for (const key of Object.keys(raw)) {
        decoded[key] = decodePathSegment(raw[key])
    }
    return decoded
}

function segmentLimitResponse(request, realPathname) {
    return new Response(JSON.stringify({
        'code': 404,
        'message': `Cannot ${request.method} ${realPathname}`,
        'timestamp': util.getTimestamp(),
    }), {
        status: 404,
        headers: {
            'content-type': 'application/json',
        }
    })
}

class Handler {
    constructor(db, options) {
        this.version = 'v2.3.3'
        this.build = '2026-06-04 10:02:45'
        this.arch = 'js'
        this.commit = '8bfd70c369b6dba3dbe53aad96d79a4367f57a45'
        this.allowNewDevice = options.allowNewDevice
        this.allowQueryNums = options.allowQueryNums

        this.register = async (parameters) => {
            const deviceToken = parameters.get('devicetoken')
            let key = parameters.get('key')
            if (key) {
                key = key.replace(/[^a-zA-Z0-9]/g, '')
            }

            if (!deviceToken) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': 'device token is empty',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            if (deviceToken.length > 160) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': 'device token is invalid',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            const keyExists = key ? (await db.deviceTokenByKey(key)) !== undefined : false

            if (!keyExists && !this.allowNewDevice) {
                return new Response(JSON.stringify({
                    'code': 500,
                    'message': 'device registration failed: register disabled',
                }), {
                    status: 500,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            if (!key) {
                key = await util.newShortUUID()
            }
            // a provided-but-unknown key is kept as-is (upsert, same as bark-server)

            await db.saveDeviceTokenByKey(key, deviceToken)

            return new Response(JSON.stringify({
                'code': 200,
                'message': 'success',
                'timestamp': util.getTimestamp(),
                'data': {
                    'key': key,
                    'device_key': key,
                    'device_token': deviceToken,
                },
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }

        this.ping = async (parameters) => {
            return new Response(JSON.stringify({
                'code': 200,
                'message': 'pong',
                'timestamp': util.getTimestamp(),
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }

        this.healthz = async (parameters) => {
            return new Response('ok', {
                status: 200,
                headers: {
                    'content-type': 'text/plain',
                }
            })
        }

        this.info = async (parameters) => {
            let devices
            if (this.allowQueryNums) {
                devices = await db.countAll()
            }

            return new Response(JSON.stringify({
                'version': this.version,
                'build': this.build,
                'arch': this.arch,
                'commit': this.commit,
                'devices': devices,
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                }
            })
        }

        this.push = async (parameters) => {
            const deviceToken = await db.deviceTokenByKey(parameters.device_key)

            if (deviceToken === undefined) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': `failed to get device token: failed to get [${parameters.device_key}] device token from database`,
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            if (!deviceToken) {
                return new Response(JSON.stringify({
                    'code': 400,
                    'message': 'device token invalid',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 400,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            const title = parameters.title || undefined
            const subtitle = parameters.subtitle || undefined
            const body = parameters.body || undefined

            let sound = parameters.sound || undefined
            if (sound) {
                if (!sound.endsWith('.caf')) {
                    sound += '.caf'
                }
            } else {
                sound = '1107'
            }

            // bark-server stringifies every ext param; numbers from a JSON body
            // (badge, volume, ttl, ...) must not reach the payload as JSON numbers
            const strParam = (v) => v ? String(v) : undefined

            const group = strParam(parameters.group)
            const call = strParam(parameters.call)
            const isArchive = strParam(parameters.isarchive)
            const icon = strParam(parameters.icon)
            const ciphertext = strParam(parameters.ciphertext)
            const level = strParam(parameters.level)
            const volume = strParam(parameters.volume)
            const url = strParam(parameters.url)
            const image = strParam(parameters.image)
            const copy = strParam(parameters.copy)
            const badge = strParam(parameters.badge)
            const autoCopy = strParam(parameters.autocopy)
            const action = strParam(parameters.action)
            const iv = strParam(parameters.iv)
            const id = strParam(parameters.id)
            // same as bark-server: only an explicit "1" is a delete push ("0" must not delete)
            const _delete = (parameters.delete === '1' || parameters.delete === 1) ? '1' : undefined
            const markdown = strParam(parameters.markdown)
            const ttl = strParam(parameters.ttl)

            // https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
            const aps = {
                'aps': (_delete) ? {
                    'content-available': 1,
                    'mutable-content': 1,
                } : {
                    'alert': {
                        'title': title,
                        'subtitle': subtitle,
                        'body': (!title && !subtitle && !body) ? 'Empty Message' : body,
                        'launch-image': undefined,
                        'title-loc-key': undefined,
                        'title-loc-args': undefined,
                        'subtitle-loc-key': undefined,
                        'subtitle-loc-args': undefined,
                        'loc-key': undefined,
                        'loc-args': undefined,
                    },
                    'badge': undefined,
                    'sound': sound,
                    'thread-id': group,
                    'category': 'myNotificationCategory',
                    'content-available': undefined,
                    'mutable-content': 1,
                    'target-content-id': undefined,
                    'interruption-level': undefined,
                    'relevance-score': undefined,
                    'filter-criteria': undefined,
                    'stale-date': undefined,
                    'content-state': undefined,
                    'timestamp': undefined,
                    'event': undefined,
                    'dimissal-date': undefined,
                    'attributes-type': undefined,
                    'attributes': undefined,
                },
                // ExtParams
                'group': group,
                'call': call,
                'isarchive': isArchive,
                'icon': icon,
                'ciphertext': ciphertext,
                'level': level,
                'volume': volume,
                'url': url,
                'copy': copy,
                'badge': badge,
                'autocopy': autoCopy,
                'action': action,
                'iv': iv,
                'image': image,
                'id': id,
                'delete': _delete,
                'markdown': markdown,
                'ttl': ttl,
            }

            const headers = {
                'apns-topic': undefined,
                'apns-id': undefined,
                'apns-collapse-id': id,
                'apns-priority': undefined,
                'apns-expiration': undefined,
                'apns-push-type': (_delete) ? 'background' : 'alert',
            }

            const apns = new APNs(db)
            const response = await apns.push(deviceToken, headers, aps)

            if (response.status === 200) {
                return new Response(JSON.stringify({
                    'code': 200,
                    'message': 'success',
                    'timestamp': util.getTimestamp(),
                }), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            } else {
                let message
                const responseText = await response.text()

                try {
                    message = JSON.parse(responseText).reason
                } catch (err) {
                    message = responseText
                }

                if ((response.status === 410) || ((response.status === 400) && (message.includes('BadDeviceToken')))) {
                    await db.saveDeviceTokenByKey(parameters.device_key, '')
                }

                return new Response(JSON.stringify({
                    'code': response.status,
                    'message': `push failed: ${message}`,
                    'timestamp': util.getTimestamp(),
                }), {
                    status: response.status,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }
        }

        this.mcp = async (request, deviceKey) => {
            if (request.method === 'DELETE') {
                const sessionId = request.headers.get('mcp-session-id')
                if (sessionId) {
                    await db.deleteSessionBySessionID(sessionId)
                }
                return new Response(null, {
                    status: 200
                })
            }

            if (request.method !== 'POST') {
                return new Response(JSON.stringify({
                    'jsonrpc': '2.0',
                    'id': null,
                    'error': {
                        'code': -32700,
                        'message': 'Method not allowed',
                    }
                }), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            let body = {}
            try {
                body = await request.json()
            } catch (err) {
                return new Response(JSON.stringify({
                    'jsonrpc': '2.0',
                    'id': null,
                    'error': {
                        'code': -32700,
                        'message': 'request body is not valid json',
                    }
                }), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            const {
                jsonrpc,
                id,
                method,
                params,
            } = body

            if (jsonrpc !== '2.0') {
                return new Response(JSON.stringify({
                    'jsonrpc': '2.0',
                    'id': id || null,
                    'error': {
                        'code': -32600,
                        'message': 'Invalid Request',
                    }
                }), {
                    status: 200,
                    headers: {
                        'content-type': 'application/json',
                    }
                })
            }

            switch (method) {
                case 'initialize': {
                    const sessionId = await util.newMCPSessionUUID()
                    await db.saveSessionBySessionID(sessionId, deviceKey, true, null)

                    return new Response(JSON.stringify({
                        'jsonrpc': '2.0',
                        'id': id,
                        'result': {
                            'protocolVersion': '2025-03-26',
                            'capabilities': {
                                'tools': {
                                    'listChanged': true,
                                },
                            },
                            'serverInfo': {
                                name: deviceKey ? 'Bark MCP Server (Specific)' : 'Bark MCP Server',
                                version: this.version,
                            },
                        }
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                            'mcp-session-id': sessionId,
                        }
                    })
                }
                case 'notifications/initialized': {
                    const sessionId = request.headers.get('mcp-session-id')
                    const session = await db.sessionBySessionID(sessionId)
                    
                    if (!session) {
                        return new Response(null, {
                            status: 400
                        })
                    }
                    
                    await db.saveSessionBySessionID(session.id, session.device_key, true, undefined)

                    return new Response(null, {
                        status: 202
                    })
                }
                case 'tools/list': {
                    const sessionId = request.headers.get('mcp-session-id')
                    const session = await db.sessionBySessionID(sessionId)
                    
                    if (!session) {
                        return new Response('Invalid session ID', {
                            status: 400,
                            headers: {
                                'content-type': 'text/plain',
                            }
                        })
                    }

                    await db.saveSessionBySessionID(session.id, session.device_key, true, undefined)

                    const sessionDeviceKey = session.device_key
                    const required = sessionDeviceKey ? [] : ['device_key']

                    const properties = {
                        'title':        { 'type': 'string', 'description': 'Notification title' },
                        'subtitle':     { 'type': 'string', 'description': 'Notification subtitle' },
                        'body':         { 'type': 'string', 'description': 'Notification content' },
                        'markdown':     { 'type': 'string', 'description': 'Markdown content, overrides body' },
                        'level':        { 'type': 'string', 'description': 'Notification level', 'enum': ['critical', 'active', 'timeSensitive', 'passive'] },
                        'volume':       { 'type': 'number', 'description': 'Alert volume (0–10)', 'minimum': 0, 'maximum': 10, 'default': 5 },
                        'badge':        { 'type': 'number', 'description': 'Badge number' },
                        'call':         { 'type': 'string', 'description': "Set to '1' to repeat ringtone" },
                        'sound':        { 'type': 'string', 'description': 'Notification sound name' },
                        'icon':         { 'type': 'string', 'description': 'Notification icon URL' },
                        'image':        { 'type': 'string', 'description': 'Notification image URL' },
                        'group':        { 'type': 'string', 'description': 'Notification group' },
                        'isArchive':    { 'type': 'string', 'description': "Set to '1' to archive, other value to skip" },
                        'ttl':          { 'type': 'number', 'description': 'Time to live in seconds for archived messages; expired items are automatically deleted' },
                        'url':          { 'type': 'string', 'description': 'Click action URL' },
                        'copy':         { 'type': 'string', 'description': 'Text to copy on copy action' },
                        'device_key': sessionDeviceKey ? undefined : { 'type': 'string', 'description': 'Device key' },
                    }

                    return new Response(JSON.stringify({
                        'jsonrpc': '2.0',
                        'id': id,
                        'result': {
                            'tools': [
                                {   
                                    'annotations': {
                                        'readOnlyHint': false,
                                        'destructiveHint': true,
                                        'idempotentHint': false,
                                        'openWorldHint': true
                                    },
                                    'name': 'notify',
                                    'description': 'Send a notification to a device via Bark',
                                    'inputSchema': {
                                        'type': 'object',
                                        'properties': properties,
                                        ...(required.length > 0 ? { required } : {})
                                    },
                                },
                            ]
                        }
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }
                case 'tools/call': {
                    const sessionId = request.headers.get('mcp-session-id')
                    const session = await db.sessionBySessionID(sessionId)
                    
                    if (!session) {
                        return new Response('Invalid session ID', {
                            status: 400,
                            headers: {
                                'content-type': 'text/plain',
                            }
                        })
                    }

                    await db.saveSessionBySessionID(session.id, session.device_key, true, undefined)

                    const { name, arguments: args = {} } = params || {}

                    if (name !== 'notify') {
                        return new Response(JSON.stringify({
                            'jsonrpc': '2.0',
                            'id': id,
                            'error': {
                                'code': -32602,
                                'message': `tool '${name}' not found: tool not found`,
                            }
                        }), {
                            status: 200,
                            headers: {
                                'content-type': 'application/json',
                            }
                        })
                    }

                    const _deviceKey = session.device_key || args.device_key || ''
                    if (!_deviceKey) {
                        return new Response(JSON.stringify({
                            'jsonrpc': '2.0',
                            'id': id,
                            'result': {
                                'content': [
                                    {
                                        'type': 'text',
                                        'text': 'device_key is required',
                                    }
                                ],
                                'isError': true,
                            }
                        }), {
                            status: 200,
                            headers: {
                                'content-type': 'application/json',
                            }
                        })
                    }
                    
                    const parameters = { ...args, 'device_key': _deviceKey }
                    const pushParams = Object.keys(parameters).reduce((obj, key) => {
                        obj[key.toLowerCase()] = parameters[key]
                        return obj
                    }, {})

                    const response = await this.push(pushParams)
                    const responseBody = await response.json()

                    if (response.status === 200) {
                        return new Response(JSON.stringify({
                            'jsonrpc': '2.0',
                            'id': id,
                            'result': {
                                'content': [
                                    {
                                        'type': 'text',
                                        'text': 'Notification sent successfully',
                                    }
                                ]
                            }
                        }), {
                            status: 200,
                            headers: {
                                'content-type': 'application/json',
                            }
                        })
                    }

                    return new Response(JSON.stringify({
                        'jsonrpc': '2.0',
                        'id': id,
                        'result': {
                            'content': [
                                {
                                    'type': 'text',
                                    'text': `Failed to send notification: ${responseBody.message}`,
                                }
                            ],
                            'isError': true,
                        }
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })

                }
                default: {
                    return new Response(JSON.stringify({
                        'jsonrpc': '2.0',
                        'id': id || null,
                        'error': {
                            'code': -32601,
                            'message': `Method not found: ${method}`,
                        }
                    }), {
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                        }
                    })
                }
            }
        }
    }
}

// APNs provider-token cache, scoped to the worker isolate
const apnsTokenCache = { token: null, time: 0 }

class APNs {
    constructor(db) {
        const generateAuthToken = async () => {
            const TOKEN_KEY = `
            -----BEGIN PRIVATE KEY-----
            MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg4vtC3g5L5HgKGJ2+
            T1eA0tOivREvEAY2g+juRXJkYL2gCgYIKoZIzj0DAQehRANCAASmOs3JkSyoGEWZ
            sUGxFs/4pw1rIlSV2IC19M8u3G5kq36upOwyFWj9Gi3Ejc9d3sC7+SHRqXrEAJow
            8/7tRpV+
            -----END PRIVATE KEY-----
            `

            // Parse private key
            const privateKeyPEM = TOKEN_KEY.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '')
            // Decode private key
            const privateKeyArrayBuffer = util.base64ToArrayBuffer(privateKeyPEM)
            const privateKey = await crypto.subtle.importKey('pkcs8', privateKeyArrayBuffer, { name: 'ECDSA', namedCurve: 'P-256', }, false, ['sign'])
            const TEAM_ID = '5U8LBRXG3A'
            const AUTH_KEY_ID = 'LH4T9V5U4R'
            // Generate the JWT token
            const JWT_ISSUE_TIME = util.getTimestamp()
            const JWT_HEADER = btoa(JSON.stringify({ alg: 'ES256', kid: AUTH_KEY_ID })).replace('+', '-').replace('/', '_').replace(/=+$/, '')
            const JWT_CLAIMS = btoa(JSON.stringify({ iss: TEAM_ID, iat: JWT_ISSUE_TIME })).replace('+', '-').replace('/', '_').replace(/=+$/, '')
            const JWT_HEADER_CLAIMS = JWT_HEADER + '.' + JWT_CLAIMS
            // Sign
            const jwtArray = new TextEncoder().encode(JWT_HEADER_CLAIMS)
            const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, jwtArray)
            const signatureArray = new Uint8Array(signature)
            const JWT_SIGNED_HEADER_CLAIMS = btoa(String.fromCharCode(...signatureArray)).replace('+', '-').replace('/', '_').replace(/=+$/, '')
            const AUTHENTICATION_TOKEN = JWT_HEADER_CLAIMS + '.' + JWT_SIGNED_HEADER_CLAIMS

            return AUTHENTICATION_TOKEN
        }

        const getAuthToken = async () => {
            // Isolate-scoped cache: isolates are reused across requests, so the
            // D1 read is skipped for the vast majority of pushes. D1 stays the
            // cross-isolate fallback. 3000s matches Apple's 60-minute token limit.
            const now = util.getTimestamp()
            if (apnsTokenCache.token && now - apnsTokenCache.time <= 3000) {
                return apnsTokenCache.token
            }

            let authToken = await db.authorizationToken()

            if (authToken) {
                apnsTokenCache.token = authToken
                apnsTokenCache.time = now
                return authToken
            }

            authToken = await generateAuthToken()
            await db.saveAuthorizationToken(authToken, util.getTimestamp())
            apnsTokenCache.token = authToken
            apnsTokenCache.time = now

            return authToken
        }

        this.push = async (deviceToken, headers, aps) => {
            const TOPIC = 'me.fin.bark'
            const APNS_HOST_NAME = 'api.push.apple.com'
            const AUTHENTICATION_TOKEN = await getAuthToken()

            return await fetch(`https://${APNS_HOST_NAME}/3/device/${deviceToken}`, {
                method: 'POST',
                headers: JSON.parse(JSON.stringify({
                    'apns-topic': headers['apns-topic'] || TOPIC,
                    'apns-id': headers['apns-id'] || undefined,
                    'apns-collapse-id': headers['apns-collapse-id'] || undefined,
                    'apns-priority': (headers['apns-priority'] > 0) ? headers['apns-priority'] : undefined,
                    'apns-expiration': headers['apns-expiration'] || util.getTimestamp() + 86400,
                    'apns-push-type': headers['apns-push-type'] || 'alert',
                    'authorization': `bearer ${AUTHENTICATION_TOKEN}`,
                    'content-type': 'application/json',
                })),
                body: JSON.stringify(aps),
            })
        }
    }
}

class Database {
    constructor(env) {
        const db = env.database

        db.exec('CREATE TABLE IF NOT EXISTS `devices` (`id` INTEGER PRIMARY KEY, `key` VARCHAR(255) NOT NULL, `token` VARCHAR(255) NOT NULL, UNIQUE (`key`))')
        db.exec('CREATE TABLE IF NOT EXISTS `authorization` (`id` INTEGER PRIMARY KEY, `token` VARCHAR(255) NOT NULL, `time` VARCHAR(255) NOT NULL)')
        db.exec('CREATE TABLE IF NOT EXISTS `sessions` (`id` VARCHAR(64) PRIMARY KEY, `device_key` VARCHAR(255), `initialized` INTEGER DEFAULT 0, `created_at` INTEGER NOT NULL, `last_seen` INTEGER NOT NULL)')

        this.countAll = async () => {
            const query = 'SELECT COUNT(*) as rowCount FROM `devices`'
            const result = await db.prepare(query).run()

            return (result.results[0] || { 'rowCount': -1 }).rowCount
        }

        this.deviceTokenByKey = async (key) => {
            const device_key = (key || '').replace(/[^a-zA-Z0-9]/g, '') || '_PLACE_HOLDER_'
            const query = 'SELECT `token` FROM `devices` WHERE `key` = ?'
            const result = await db.prepare(query).bind(device_key).run()

            return (result.results[0] || { 'token': undefined }).token
        }

        this.saveDeviceTokenByKey = async (key, token) => {
            // sanitize the key exactly like deviceTokenByKey() does,
            // so every saved key stays findable afterwards
            const device_key = (key || '').replace(/[^a-zA-Z0-9]/g, '')
            const device_token = (token || '').replace(/[^a-z0-9]/g, '') || ''
            const query = 'INSERT INTO `devices` (`key`, `token`) VALUES (?, ?) ON CONFLICT(`key`) DO UPDATE SET `token` = EXCLUDED.`token`'
            const result = await db.prepare(query).bind(device_key, device_token).run()

            return result
        }

        this.deleteDeviceByKey = async (key) => {
            const device_key = (key || '').replace(/[^a-zA-Z0-9]/g, '') || '_PLACE_HOLDER_'
            const query = 'DELETE FROM `devices` WHERE `key` = ?'
            const result = await db.prepare(query).bind(device_key).run()

            return result
        }

        this.saveAuthorizationToken = async (token) => {
            const query = 'INSERT INTO `authorization` (`id`, `token`, `time`) VALUES (1, ?, ?) ON CONFLICT(`id`) DO UPDATE SET `token` = EXCLUDED.`token`,`time` = EXCLUDED.`time`'
            const result = await db.prepare(query).bind(token, util.getTimestamp()).run()

            return result
        }

        this.authorizationToken = async () => {
            const query = 'SELECT `token`, `time` FROM `authorization` WHERE `id` = 1'
            const result = await db.prepare(query).run()

            if (result.results.length > 0) {
                const tokenTime = parseInt(result.results[0].time)
                const timeDifference = util.getTimestamp() - tokenTime

                if (timeDifference <= 3000) {
                    return result.results[0].token
                }
            }

            return undefined
        }

        this.sessionBySessionID = async (sessionId) => {
            const now = util.getTimestamp()
            const query = 'SELECT `id`, `device_key`, `initialized` FROM `sessions` WHERE `id` = ? AND `last_seen` > ? AND `created_at` > ?'
            const result = await db.prepare(query).bind(sessionId, now - 3600, now - 86400).run()

            return result.results[0] || null
        }

        this.saveSessionBySessionID = async (sessionId, deviceKey, initialized, lastSeen) => {
            const now = util.getTimestamp()
            const query = 'INSERT INTO `sessions` (`id`, `device_key`, `initialized`, `created_at`, `last_seen`) VALUES (?, ?, ?, ?, ?) ON CONFLICT(`id`) DO UPDATE SET `initialized` = EXCLUDED.`initialized`, `last_seen` = EXCLUDED.`last_seen`'

            return await db.prepare(query).bind(sessionId, deviceKey || null, initialized ? 1 : 0, now, lastSeen ?? now).run()
        }

        this.deleteSessionBySessionID = async (sessionId) => {
            const query = 'DELETE FROM `sessions` WHERE `id` = ?'

            return await db.prepare(query).bind(sessionId).run()
        }

        this.cleanupExpiredSessions = async () => {
            const now = util.getTimestamp()

            const query = 'DELETE FROM `sessions` WHERE `last_seen` < ? OR `created_at` < ?'
            return await db.prepare(query).bind(now - 3600, now - 86400).run()
        }
    }
}

class Util {
    constructor() {
        this.getTimestamp = () => {
            return Math.floor(Date.now() / 1000)
        }

        this.base64ToArrayBuffer = (base64) => {
            const binaryString = atob(base64)
            const length = binaryString.length
            const buffer = new Uint8Array(length)
            for (let i = 0; i < length; i++) {
                buffer[i] = binaryString.charCodeAt(i)
            }
            return buffer
        }

        this.newShortUUID = async () => {
            const uuid = crypto.randomUUID()
            const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uuid))
            const hashArray = Array.from(new Uint8Array(hashBuffer))

            return btoa(String.fromCharCode(...hashArray)).replace(/[^a-zA-Z0-9]|[lIO01]/g, '').slice(0, 22)
        }

        this.newMCPSessionUUID = async () => {
            const uuid = crypto.randomUUID()
            
            return `mcp-session-${uuid}`
        }

        const constantTimeCompare = (a, b) => {
            if (typeof a !== 'string' || typeof b !== 'string') { return false }
            if (a.length !== b.length) { return false }
            let result = 0
            for (let i = 0; i < a.length; i++) {
                result |= a.charCodeAt(i) ^ b.charCodeAt(i)
            }
            return result === 0
        }

        this.validateBasicAuth = (request, basicAuth) => {
            if (basicAuth) {
                const authHeader = request.headers.get('Authorization')
                if (typeof authHeader !== 'string' || !authHeader.startsWith('Basic ')) { return false }
                const received = authHeader.slice(6) // Remove 'Basic ' prefix
                const expected = btoa(`${basicAuth}`)
                return constantTimeCompare(received, expected)
            }
            return true
        }
    }
}

const util = new Util()