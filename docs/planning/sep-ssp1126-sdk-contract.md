# SSP1126 managed API inspection and diagnostic contract

Date: 25 October 2026. Phase C groundwork; no purchase adapter is implemented.

## Evidence and boundaries

The user supplied successful Firefox results from the existing HTTPS POS for
both plain GET and GET with `X-Run-Cafe-Diagnostic`. Each returned HTTP 200 and
the expected health-only response. The user confirmed no VPN or proxy was
active. This establishes the normal cashier transport, including the headered
CORS request, without a browser security change. Actual OPTIONS-panel capture,
browser offline/recovery, and another login remain operational follow-ups.

SDK inspection is static only. No SDK code is executed on the cashier by this
work. The installed health binary is unchanged and still cannot load SEP.
The diagnostic adapter and one-shot worker are a separate artifact to compile
and test before separately approved Windows execution. They expose no HTTP
operation, login task, or purchase entry point. The launcher bounds the worker
process to 30 seconds and waits for termination before returning a deadline.

The inspected files are SSP1126.PcPos 1.4.11.1 and Sep.Logger 1.0.0.2, with the
hashes recorded in the integration audit. Fresh disassembly matches the supplied
IL's module identity and inspected methods. Read-only Windows hashes confirm
the exact same SDK package. A direct managed reference is preferred over the legacy COM interface
because it exposes the actual factory contract and avoids COM activation and
marshalling. Hash-check the assemblies actually loaded before factory creation.
Do not move, replace, or re-register the currently registered Windows files.

## Exact diagnostic API

```csharp
using SSP1126.PcPos.BaseClasses;
using SSP1126.PcPos.Infrastructure;

PcPosFactory factory = new PcPosFactory();
bool selected = factory.SetLan("192.168.1.101");
// Stop on false; never initialize before SetLan.
factory.Initialization(ResponseLanguage.English, 10, AsyncType.Sync);
IPosResult result = factory.ConnectionTest();
// Read only ResponseCode and TerminalId. Never serialize result.
// factory.TerminalID() also returns IPosResult and is a separate device request.
factory.Dispose(); // Network activity is possible, see below.
```

`SspNetwork` takes its port from `Common.SSpPort`, initialized to 1197. `SetLan`
accepts an IP string, not a documented IP/port tuple. Do not guess a colon-port
syntax or change internal fields. Until an official alternative is established,
the adapter supports the verified fixed port 1197 only.

For this read-only diagnostic, only response `00` with the exact expected
eight-digit terminal identity is connected. `03` maps to the SDK's No Connection;
`99` is its POS timeout. Both are unavailable outcomes for this diagnostic.
Other/malformed/null responses are protocol errors. A successful connection
description is not payment approval. These rules are not purchase classifiers.

Use one process-wide device gate, including construction and cleanup. Reject
another diagnostic as busy rather than queueing an implicit repeat. Do not
release that gate just because an HTTP/browser timeout occurs. No purchase
method exists in the diagnostic interface or implementation.

## Logging must be disabled before construction

`Sep.Logger.Constants.logPermission` reads the application setting
`LogPermission`. An exact integer zero disables logging; missing/invalid values
enable logging. Its fallback log directory is `C:\Sep-SSP`. Several SDK paths
call `PosResult.ToString()`, which serializes the whole object using
`JavaScriptSerializer`. That object contains card fields. Never call or forward
that serialization, and never log raw ResponseDescription or exception messages.

The diagnostic host explicitly configures `LogPermission=0`, and the adapter
refuses construction otherwise. After checking actual loaded DLL hashes, it
also requires `Sep.Logger.Constants.logPermission` to evaluate to zero before
constructing the factory. `SepDiagnosticsEnabled` defaults to false. Static
review shows the logger constructor and used log overloads check the
permission before writing. This is not yet runtime proof that every possible
vendor output is suppressed; isolated Windows verification is still required
before financial use. Do not attach internal MessageEngine logging listeners.

## Timeout and cleanup effects

`PcStarterPurchase` in Sync mode calls `DoSyncOperation`, which waits for data
or its timer. Timeout paths can send a timeout protocol message. `PosWaitForResult`
is not passive saved-attempt lookup: it resets waiting flags and performs
another result wait. Never expose it as ordinary browser status polling.

`PcPosFactory.Dispose` virtually dispatches to `SspNetwork.Dispose`. That method
creates a dispose protocol message, may call `connect()` when disconnected,
sends the message, disconnects, then calls base cleanup. `EndOfTransaction` also
calls virtual Dispose. Therefore even a normal diagnostic can perform cleanup
network activity internally, and a failed/uncertain purchase must not be
wrapped in an unconditional HTTP-request-scoped dispose/retry pattern.

The configured SDK timeout is not a demonstrated wall-clock bound for socket
connect, internal cleanup, or all worker threads. A separately owned diagnostic
worker process provides the prepared package's hard deadline boundary. Do not use
Thread.Abort or abandon an in-process SDK call and release the device lock.
The diagnostic core keeps the lock until cleanup has returned. A Global mutex
owned by the worker also guards across Windows login/SSH sessions; that still
needs Windows runtime verification. No worker or new SDK artifact is installed
by this change.

## Purchase signature, inspected but unused

The managed factory exposes this exact signature and defaults:

```csharp
IPosResult PcStarterPurchase(
    string mainAmount,
    string amounts,
    string additionalData,
    string referenceData,
    string ValidTerminalID = null,
    string PurchaseID = null,
    string ReserveData = null,
    int ReserveFlag = -1,
    string Amount_Iban = null,
    long totalAmount = -1);
```

The legacy `IPcPosFactory` interface has a four-argument signature with a
different declared result type. Do not use that older interface as the contract
for the actual managed factory. The names/defaults above do not establish the
business meaning or safe allowed values of every argument. There is no purchase
call in the Phase C diagnostic source, test, or installed artifact.

SDK metadata exposes `PaidAmount`, `RRN`, `TraceNumber`, `TerminalId`, and
`ResponseCode`; field presence alone is not evidence of an authenticated bank
result or a retry-safe inquiry. The converter maps RRN from field 37, TraceNumber
from 38, TerminalId from 41, ReqAmount from 54, AffectiveAmount from 6, and
SettelAmount from 5. No assignment to PaidAmount was found in the inspected SDK
apart from its setter implementation. Do not build automatic amount verification
on that property's name. Until a returned amount's meaning, unit, and presence
are verified, preserve explicit manual reconciliation instead of automatically
posting a purported approval. Verify correlation, lost-result recovery, and exact
response semantics before use.

## Tester calibration and remaining purchase gates

The supplied PDF is a three-page Pejvak Q80 LAN/registration/setup guide, not an
SDK API manual. Page 2's tester screenshot labels its input only `Amount`.
Page 3's accounting-product screenshot labels amount sending in Rial. That is
useful supporting evidence but does not alone establish the unit of this DLL.

The operator confirmed the existing successful tester input was **1000**, with
**10000 Rial / 1000 Toman** on the receipt. No new payment was requested. A
read-only copy of the actual Windows tester is a native Delphi x86 executable,
SHA-256 `b9064f3432d17a619b4b06eb5efcb24c1d7bdf07276b16bc47a29d3e8e264044`.
Its `Btn_PaymentClick` entry is at VA 0x004c653c. Form RTTI identifies edtAmount
at offset 0x394; VA 0x004c6628 through 0x004c6654 reads that control text,
converts string representation, and passes it as the first argument to COM
DISPID 0x60020019, PcStarterPurchase, without an observed numeric scaling step.
The inspected managed purchase builder places mainAmount in request field 4.

Together, this is setup-specific evidence that the tested numeric SDK input
corresponds to Toman. It does not justify multiplying a Toman order amount by
10 before that same call. Preserve the observed calibration explicitly rather
than imposing a generic provider-unit assumption. The underlying bank wire unit
and returned amount fields still need verification before automatic financial
posting. No conversion or purchase is implemented in this phase.

The SDK parses mainAmount as Int64 and reads a configurable MinimumAmount.
Its config/file fallback behavior means a guessed minimum is unsafe too.
No amount conversion or purchase bounds are implemented in this phase.

## Verification and remaining gates

Direct compilation against the pinned package passes without vendor execution.
All 17 fake diagnostic tests pass, covering identity, unavailable/protocol/null
results, selection/init/cleanup failures and concurrent requests through cleanup.
The real worker passes 4 guard checks without vendor DLL files present. Its
PowerShell launcher parses with zero errors on the actual Windows PowerShell
4.0. SDK hashes match Windows, and package manifest/source hashes validate.

The prepared diagnostic ZIP is 87,509 bytes, SHA-256
`a71d68a69f63b40923acf4949ac48f521a49eea079e197804f38291990990d56`.
It is distinct from the installed health ZIP and has not been transferred,
installed, or run on the cashier. Separate approval is needed for a single
idle-terminal connection diagnostic and its SDK cleanup. Windows runtime
logging containment, worker deadlines, cross-session exclusion, and all
financial result/reconciliation behavior remain gates. Retain the installed
health-only task while reviewing the new artifact.

## Phase D–F purchase worker implementation

The separate disabled payment worker now calls the inspected ten-argument managed
method using authorized integer-Toman decimal text, null amounts/additionalData/
referenceData, expected ValidTerminalID, null PurchaseID/ReserveData, ReserveFlag
-1, null Amount_Iban, and totalAmount -1. IL CreatePcStarterPurchase guards the
optional extension fields for null/empty, writes mainAmount to field 4, and writes
ValidTerminalID to field 41. No account split, print extension or purchase-ID
semantics are assumed. The factory dispatches the exact ten arguments to its
network instance. Before purchase the worker requires ConnectionTest code 00
and exact terminal identity, and checks ticket expiry again. This source has
compiled but no purchase has been executed. Returned evidence remains subject
to the manual verification gate above.

For comparison only, the [unofficial TypeScript implementation's README](https://github.com/vhidvz/saman-payment-pos)
describes the same TCP port and PC-initiated purchase shape, explicitly reserves
PurchaseID for identified purchases, and exposes automatic first-timeout retry
and raw-frame logging options. Neither retry nor raw logging is adopted here.
The official DLL, inspected IL, and actual cashier calibration remain the
contract for this implementation. No Node runtime or unofficial SDK is shipped.
