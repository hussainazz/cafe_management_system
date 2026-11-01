using System;
using System.Globalization;

namespace RunCafe.SepBridge.Payments
{
    /// <summary>Converts the backend's integer Toman amount to SSP1126's Rial amount field.</summary>
    internal static class SepAmount
    {
        internal static string TomanToRial(long amountToman)
        {
            if (amountToman < 1 || amountToman > Int32.MaxValue)
                throw new ArgumentOutOfRangeException("amountToman");

            return checked(amountToman * 10L).ToString(CultureInfo.InvariantCulture);
        }
    }
}
