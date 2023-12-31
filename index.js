const HTMLParser = require('./htmlparser')

const evalFn = exp => new Function(`return (${exp})`)

const isArrowFunction = fn => {
    const str = fn.toString()
    if (str.match(/{[\s\S]*}/)) {
        return str.replace(/{[\s\S]*}/, '').includes('=>')
    } else {
        return true
    }
}

module.exports = function(source) {
    console.log(this)
    const nodeList = []
    HTMLParser(source, (function() {
        var obj = {}
        !['start', 'end', 'comment', 'chars'].forEach(x => {
            obj[x] = function (...args) {
                if (x !== 'chars' || !/^[\s\r\n\t]*$/g.test(args[0])) {
                    nodeList.push({ tagType: x, attrs: args })
                }
            }
        })
        return obj
    })())
    const nodeStruct = []

    const createTree = (tree, node) => {
        const { tagType } = node
        const curNode = nodeStruct.reduce((p, c) => p.children[c], tree)
        if (tagType === 'start') {
            const { attrs } = node
            const [ nodeName, nodeAttrs ] = attrs
            if (!curNode.children) {
                curNode.children = {}
            }
            let symbolName = Symbol(nodeName)
            curNode.children[symbolName] = {
                attrs: nodeAttrs.reduce((p, c) => ({ ...p, [c.name]: c.value }), {})
            }
            nodeStruct.push(symbolName)
        } else if (tagType === 'end') {
            const { attrs } = node
            const [ nodeName ] = attrs
            if (nodeName === nodeStruct[nodeStruct.length - 1].description) {
                nodeStruct.splice(nodeStruct.length - 1, 1)
            } else {
                console.error(`${ nodeStruct[nodeStruct.length - 1] }无闭合`)
            }
        } else if (tagType === 'chars') {
            const { attrs } = node
            const [ content ] = attrs
            curNode.content = content
        }
    }
    const root = {}
    const elList = []
    nodeList.forEach(node => createTree(root, node))
    let scriptImport = ''
    if (root.children) {
        const rootNodeKeys = Reflect.ownKeys(root.children)
        const canvasNodeIndex = rootNodeKeys.findIndex(item => item.description === 'canvas')
        const scriptNodeIndex = rootNodeKeys.findIndex(item => item.description === 'script')
        const canvasNode = root.children[rootNodeKeys[canvasNodeIndex]]
        const scriptNode = root.children[rootNodeKeys[scriptNodeIndex]]
        const scriptContent = scriptNode.content.trim()
        let scriptObj
        if (scriptContent.startsWith('import')) {
            scriptImport = scriptContent.slice(0, scriptContent.indexOf('{') - 1)
            scriptObj = (evalFn(scriptContent.slice(scriptContent.indexOf('{'))))()
        } else {
            scriptObj = (evalFn(scriptContent))()
        }
        const collectCanvasElList = node => {
            Reflect.ownKeys(canvasNode.children).forEach(elName => {
                const elProps = {}
                for (let elAttrName in canvasNode.children[elName].attrs) {
                    let elAttrValue = canvasNode.children[elName].attrs[elAttrName]
                    if (elAttrName.startsWith(':')) {
                        const attrName = elAttrName.slice(1)
                        try {
                            elProps[attrName] = (evalFn(elAttrValue))()
                        } catch (e) {
                            try {
                                elProps[attrName] = scriptObj.data[elAttrValue]
                            } catch (e) {
                                console.error(e)
                            }
                        }
                    } else if (elAttrName.startsWith('@')) {
                        const eventName = elAttrName.slice(1)
                        if (!elProps.on) {
                            elProps.on = {}
                        }
                        let fn
                        try {
                            fn = evalFn(elAttrValue)()
                            elProps.on[eventName] = fn
                        } catch (e) {
                            try {
                                fn = scriptObj.methods[elAttrValue]
                                elProps.on[eventName] = fn
                            } catch (e) {
                                console.error(e)
                            }
                        }
                    } else {
                        elProps[elAttrName] = elAttrValue
                    }
                }
                switch (elName.description) {
                    case 'button':
                    case 'checkbox':
                    case 'dropdown':
                    case 'link':
                    case 'span':
                        if (canvasNode.children[elName].content) {
                            elProps.text = canvasNode.children[elName].content
                        }
                        break
                    default:
                        break
                }
                const obj2Str = target => {
                    let str = ''
                    let isAsync = false
                    for (let item in target) {
                        if (Object.prototype.toString.call(target[item]) === '[object Object]') {
                            str += `${item}:{${obj2Str(target[item])}},`
                        } else if (Array.isArray(target[item])) {
                            str += `${item}:${JSON.stringify(target[item])},`
                        } else if (typeof target[item] === 'function') {
                            let fnBody, fnArgs
                            if (isArrowFunction(target[item])) {
                                fnBody = target[item].toString().slice(target[item].toString().indexOf('>') + 1)
                                fnArgs = target[item].toString().replace(fnBody, '').replace('=>', '').trim()
                                if (fnArgs.startsWith('(') && fnArgs.endsWith(')')) {
                                    fnArgs = fnArgs.slice(1,  -1)
                                }
                            } else {
                                fnBody = target[item].toString().slice(target[item].toString().indexOf('{') + 1, target[item].toString().indexOf('}'))
                                fnArgs = target[item].toString().replace(fnBody, '').trim()
                                isAsync = fnArgs.startsWith('async')
                                fnArgs = fnArgs.slice(fnArgs.indexOf('(') + 1, fnArgs.indexOf(')'))
                            }
                            str += `${item}:${isAsync ? 'async ' : ''}function(${fnArgs}) {${fnBody}},`
                        } else {
                            str += `${item}:"${target[item]}",`
                        }
                    }
                    return str
                }
                elList.push(`h('${elName.description}', {${obj2Str(elProps)}})`)
            })
        }
        collectCanvasElList(canvasNode)
    }
    const result = `
        ${ scriptImport }
        export default {
            render: h => [${elList}]
        }
    `
    return result
}