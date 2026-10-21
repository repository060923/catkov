/**
 * PowerShell-hosted Windows Job Object launcher. A suspended child is assigned
 * before it can spawn descendants. Closing the job handle terminates the tree,
 * including when the supervising PowerShell process is terminated unexpectedly.
 * No native files need to be compiled or distributed with the npm package.
 */
const JOB_LAUNCHER_CSHARP = String.raw`
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class CatkovWindowsJob
{
    const uint CREATE_SUSPENDED = 0x00000004;
    const uint CREATE_NO_WINDOW = 0x08000000;
    const uint STARTF_USESTDHANDLES = 0x00000100;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    const int JobObjectExtendedLimitInformation = 9;
    const uint INFINITE = 0xFFFFFFFF;
    const uint HANDLE_FLAG_INHERIT = 0x00000001;

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public IntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO {
        public uint cb;
        public string lpReserved, lpDesktop, lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars;
        public uint dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION {
        public IntPtr hProcess, hThread;
        public uint dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "CreateProcessW")]
    static extern bool CreateProcess(string application, StringBuilder commandLine,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles,
        uint creationFlags, IntPtr environment, string directory,
        ref STARTUPINFO startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    static void Check(bool ok, string operation) {
        if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }

    public static int Run(string executable, string scriptPath, string directory) {
        IntPtr job = IntPtr.Zero;
        PROCESS_INFORMATION child = new PROCESS_INFORMATION();
        try {
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject");
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            Check(SetInformationJobObject(job, JobObjectExtendedLimitInformation,
                ref info, (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))), "SetInformationJobObject");

            var si = new STARTUPINFO();
            si.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
            si.dwFlags = STARTF_USESTDHANDLES;
            si.hStdInput = GetStdHandle(-10);
            si.hStdOutput = GetStdHandle(-11);
            si.hStdError = GetStdHandle(-12);
            Check(SetHandleInformation(si.hStdInput, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT), "stdin inheritance");
            Check(SetHandleInformation(si.hStdOutput, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT), "stdout inheritance");
            Check(SetHandleInformation(si.hStdError, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT), "stderr inheritance");
            var arguments = new StringBuilder("\"" + executable + "\" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + scriptPath + "\"");
            Check(CreateProcess(executable, arguments, IntPtr.Zero, IntPtr.Zero,
                true, CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, directory,
                ref si, out child), "CreateProcessW");
            try {
                Check(AssignProcessToJobObject(job, child.hProcess), "AssignProcessToJobObject");
                if (ResumeThread(child.hThread) == 0xFFFFFFFF)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "ResumeThread");
                if (WaitForSingleObject(child.hProcess, INFINITE) != 0)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "WaitForSingleObject");
                uint exitCode;
                Check(GetExitCodeProcess(child.hProcess, out exitCode), "GetExitCodeProcess");
                return unchecked((int)exitCode);
            } catch {
                TerminateProcess(child.hProcess, 1);
                throw;
            }
        } finally {
            if (child.hThread != IntPtr.Zero) CloseHandle(child.hThread);
            if (child.hProcess != IntPtr.Zero) CloseHandle(child.hProcess);
            // KILL_ON_JOB_CLOSE reaps every descendant, even after the direct child exits.
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }
}
`;

/** Windows PowerShell -EncodedCommand expects UTF-16LE base64. */
export function encodePowerShell(source: string): string {
  return Buffer.from(source, 'utf16le').toString('base64');
}

export function createPowerShellScript(userCommand: string): string {
  return [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [Console]::OutputEncoding',
    '& {',
    userCommand,
    '}',
    'if ($null -ne $global:LASTEXITCODE) { exit $global:LASTEXITCODE }',
    'if ($?) { exit 0 } else { exit 1 }',
  ].join('\n');
}

export function createWindowsJobCommand(scriptPath: string): string {
  const safePath = scriptPath.replace(/'/g, "''");
  const supervisor = [
    "$ErrorActionPreference = 'Stop'",
    "$code = @'",
    JOB_LAUNCHER_CSHARP,
    "'@",
    'Add-Type -TypeDefinition $code -Language CSharp -ErrorAction Stop',
    "$exe = Join-Path $PSHOME 'powershell.exe'",
    `exit ([CatkovWindowsJob]::Run($exe, '${safePath}', (Get-Location).Path))`,
  ].join('\n');
  return encodePowerShell(supervisor);
}
