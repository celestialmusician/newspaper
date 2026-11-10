from django.db import models


class Location(models.Model):
    """Central hierarchy: Country → State → District → City → Locality → Area (area carries pincode + map centre).

    Coordinates are stored as lat/lng floats (portable). With USE_POSTGIS=true, add a
    `PointField` and GiST index in a follow-up migration for radius / route queries.
    """

    class Level(models.TextChoices):
        COUNTRY = 'country'
        STATE = 'state'
        DISTRICT = 'district'
        CITY = 'city'
        LOCALITY = 'locality'
        AREA = 'area'

    ext_id = models.CharField(max_length=40, blank=True, db_index=True)
    level = models.CharField(max_length=10, choices=Level.choices)
    name = models.CharField(max_length=120)
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.CASCADE, related_name='children')
    pincode = models.CharField(max_length=6, blank=True, db_index=True)
    lat = models.FloatField(null=True, blank=True)
    lng = models.FloatField(null=True, blank=True)
    created_by = models.ForeignKey('accounts.User', null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['parent', 'name'], name='uniq_location_name_per_parent')]
        ordering = ['name']

    def ancestors(self):
        chain, node = [], self
        while node:
            chain.insert(0, node)
            node = node.parent
        return chain

    def descendant_ids(self):
        ids, frontier = {self.id}, [self.id]
        while frontier:
            frontier = list(Location.objects.filter(parent_id__in=frontier).values_list('id', flat=True))
            ids.update(frontier)
        return ids

    def __str__(self):
        return f'{self.name} ({self.level})'
