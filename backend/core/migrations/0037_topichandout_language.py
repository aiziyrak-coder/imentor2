from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0036_livetestsession_subject_code"),
    ]

    operations = [
        migrations.AddField(
            model_name="topichandout",
            name="language",
            field=models.CharField(db_index=True, default="uz", max_length=8),
        ),
        migrations.AddIndex(
            model_name="topichandout",
            index=models.Index(fields=["topic_norm", "language"], name="core_topich_topic_n_lang_idx"),
        ),
    ]
