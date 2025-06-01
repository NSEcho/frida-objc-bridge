let markUsed = null;

export function makeMethodInvocationWrapper(api, method, owner, superSpecifier, invocationOptions) {
        const sel = method.sel;
        let handle = method.handle;
        let types;
        if (handle === undefined) {
            handle = null;
            types = method.types;
        } else {
            types = api.method_getTypeEncoding(handle).readUtf8String();
        }

        const signature = parseSignature(types);
        const retType = signature.retType;
        const argTypes = signature.argTypes.slice(2);

        const objc_msgSend = superSpecifier
            ? getMsgSendSuperImpl(signature, invocationOptions)
            : getMsgSendImpl(signature, invocationOptions);

        // hack to prevent rollup from dropping objc_msgSend
        markUsed = objc_msgSend;
        
        const argVariableNames = argTypes.map(function (t, i) {
            return "a" + (i + 1);
        });
        const callArgs = [
            superSpecifier ? "superSpecifier" : "this",
            "sel"
        ].concat(argTypes.map(function (t, i) {
            if (t.toNative) {
                return "argTypes[" + i + "].toNative.call(this, " + argVariableNames[i] + ")";
            }
            return argVariableNames[i];
        }));
        let returnCaptureLeft;
        let returnCaptureRight;
        if (retType.type === 'void') {
            returnCaptureLeft = "";
            returnCaptureRight = "";
        } else if (retType.fromNative) {
            returnCaptureLeft = "return retType.fromNative.call(this, ";
            returnCaptureRight = ")";
        } else {
            returnCaptureLeft = "return ";
            returnCaptureRight = "";
        }

        const m = eval("var m = function (" + argVariableNames.join(", ") + ") { " +
            returnCaptureLeft + "objc_msgSend(" + callArgs.join(", ") + ")" + returnCaptureRight + ";" +
        " }; m;");

        Object.defineProperty(m, 'handle', {
            enumerable: true,
            get: getMethodHandle
        });

        m.selector = sel;

        Object.defineProperty(m, 'implementation', {
            enumerable: true,
            get() {
                const h = getMethodHandle();

                const impl = new NativeFunction(api.method_getImplementation(h), m.returnType, m.argumentTypes, invocationOptions);

                const newImp = getReplacementMethodImplementation(h);
                if (newImp !== null)
                    impl._callback = newImp;

                return impl;
            },
            set(imp) {
                replaceMethodImplementation(getMethodHandle(), imp);
            }
        });

        m.returnType = retType.type;

        m.argumentTypes = signature.argTypes.map(t => t.type);

        m.types = types;

        Object.defineProperty(m, 'symbol', {
            enumerable: true,
            get() {
                return `${method.kind}[${owner.$className} ${selectorAsString(sel)}]`;
            }
        });

        m.clone = function (options) {
            return makeMethodInvocationWrapper(method, owner, superSpecifier, options);
        };

        function getMethodHandle() {
            if (handle === null) {
                if (owner.$kind === 'instance') {
                    let cur = owner;
                    do {
                        if ("- forwardingTargetForSelector:" in cur) {
                            const target = cur.forwardingTargetForSelector_(sel);
                            if (target === null)
                                break;
                            if (target.$kind !== 'instance')
                                break;
                            const h = api.class_getInstanceMethod(target.$class.handle, sel);
                            if (!h.isNull())
                                handle = h;
                            else
                                cur = target;
                        } else {
                            break;
                        }
                    } while (handle === null);
                }

                if (handle === null)
                    throw new Error("Unable to find method handle of proxied function");
            }

            return handle;
        }

        return m;
    }