using System;
using RunCafe.SepBridge.Payments;

internal static class SepAmountTests
{
    private static void Check(bool value) { if (!value) throw new Exception("SEP amount assertion failed"); }
    private static void Reject(long value)
    {
        try { SepAmount.TomanToRial(value); }
        catch (ArgumentOutOfRangeException) { return; }
        throw new Exception("Invalid Toman amount was accepted");
    }

    private static int Main()
    {
        Check(SepAmount.TomanToRial(590000) == "5900000");
        Check(SepAmount.TomanToRial(1) == "10");
        Check(SepAmount.TomanToRial(Int32.MaxValue) == "21474836470");
        Reject(0);
        Reject(-1);
        Reject((long)Int32.MaxValue + 1);
        Console.WriteLine("SEP amount conversion passed: integer Toman to Rial, bounds, invariant formatting.");
        return 0;
    }
}
