using System.Drawing;

namespace Wordfall;

/// <summary>
/// Tiny modal progress window shown while an update downloads. Period-correct enough:
/// plain Win95 colours and a standard progress bar, no styling tricks.
/// </summary>
internal sealed class UpdateProgressForm : Form
{
    private readonly Label _label;
    private readonly ProgressBar _bar;

    public UpdateProgressForm(string version)
    {
        Text = "Wordfall Update";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MinimizeBox = false;
        MaximizeBox = false;
        ShowInTaskbar = false;
        ClientSize = new Size(380, 116);
        BackColor = Color.FromArgb(192, 192, 192);
        Font = new Font("Microsoft Sans Serif", 8.25f);

        _label = new Label
        {
            Text = "Downloading Wordfall " + version + "…",
            AutoSize = false,
            Location = new Point(14, 16),
            Size = new Size(352, 20),
        };

        _bar = new ProgressBar
        {
            Location = new Point(14, 44),
            Size = new Size(352, 22),
            Minimum = 0,
            Maximum = 100,
        };

        var note = new Label
        {
            Text = "The game will restart when the update is ready.",
            AutoSize = false,
            Location = new Point(14, 74),
            Size = new Size(352, 18),
            ForeColor = Color.FromArgb(64, 64, 64),
        };

        Controls.Add(_label);
        Controls.Add(_bar);
        Controls.Add(note);
    }

    public void SetProgress(int percent)
    {
        int clamped = Math.Clamp(percent, 0, 100);
        if (IsDisposed) return;
        _bar.Value = clamped;
        if (clamped >= 100) _label.Text = "Verifying and staging the update…";
    }
}
