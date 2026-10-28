/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { handleServerError } from '@/lib/handle-server-error'

import { getPersonalChannels, getPersonalGroups, submitChannel } from './api'
import { ChannelForm } from './components/channel-form'
import { ChannelStatus } from './components/channel-status'
import { GroupForm } from './components/group-form'
import type { PersonalChannel, PersonalGroup } from './types'

export function PersonalGroups() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [page, setPage] = useState(1)
  const [groupEditor, setGroupEditor] = useState<PersonalGroup | 'new' | null>(
    null
  )
  const [channelEditor, setChannelEditor] = useState<
    PersonalChannel | 'new' | null
  >(null)
  const groups = useQuery({
    queryKey: ['personal-groups'],
    queryFn: getPersonalGroups,
  })
  const channels = useQuery({
    queryKey: ['personal-channels', page],
    queryFn: () => getPersonalChannels(page),
  })
  const submit = useMutation({
    mutationFn: submitChannel,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['personal-channels'] })
      toast.success(t('Submitted for review'))
    },
    onError: handleServerError,
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Personal Groups')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button variant='outline' onClick={() => setGroupEditor('new')}>
          {t('Create Group')}
        </Button>
        <Button
          disabled={!groups.data?.length}
          onClick={() => setChannelEditor('new')}
        >
          {t('Add Channel')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-6'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Manage your group ratios. New channels and all channel changes require administrator approval.'
            )}
          </p>
          {(groups.isPending || channels.isPending) && (
            <Skeleton className='h-20 w-full' />
          )}
          {(groups.error || channels.error) && (
            <div role='alert'>
              <p>{groups.error?.message || channels.error?.message}</p>
              <Button
                variant='outline'
                onClick={() => {
                  void groups.refetch()
                  void channels.refetch()
                }}
              >
                {t('Retry')}
              </Button>
            </div>
          )}
          {groups.data?.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {t('Create a group before adding channels.')}
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
          {!!groups.data?.length && (
            <section aria-label={t('Personal Groups')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Group')}</TableHead>
                    <TableHead>{t('Description')}</TableHead>
                    <TableHead>{t('Group Ratio')}</TableHead>
                    <TableHead>{t('Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.data.map((group) => (
                    <TableRow key={group.id}>
                      <TableCell className='font-mono'>{group.name}</TableCell>
                      <TableCell className='max-w-64 break-words whitespace-normal'>
                        {group.description}
                      </TableCell>
                      <TableCell>{group.ratio}</TableCell>
                      <TableCell>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => setGroupEditor(group)}
                          aria-label={`${t('Edit')} ${group.name}`}
                        >
                          {t('Edit')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
          <section
            aria-label={t('My Channels')}
            className='flex flex-col gap-3'
          >
            <h2 className='font-semibold'>{t('My Channels')}</h2>
            <p className='text-muted-foreground text-sm'>
              {t(
                'The published version keeps serving requests while changes await approval.'
              )}
            </p>
            {channels.data?.items.length === 0 && (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t('No channels yet')}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
            {!!channels.data?.items.length && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Name')}</TableHead>
                    <TableHead>{t('Group')}</TableHead>
                    <TableHead>{t('Status')}</TableHead>
                    <TableHead>{t('Review Reason')}</TableHead>
                    <TableHead>{t('Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channels.data.items.map((channel) => (
                    <TableRow key={channel.id}>
                      <TableCell className='max-w-48 break-words whitespace-normal'>
                        {channel.config.name}
                      </TableCell>
                      <TableCell>{channel.group_name}</TableCell>
                      <TableCell>
                        <ChannelStatus channel={channel} />
                      </TableCell>
                      <TableCell className='max-w-64 break-words whitespace-normal'>
                        {channel.revision.reason || '—'}
                      </TableCell>
                      <TableCell>
                        <div className='flex gap-2'>
                          <Button
                            variant='outline'
                            size='sm'
                            onClick={() => setChannelEditor(channel)}
                            aria-label={`${t('Edit')} ${channel.config.name}`}
                          >
                            {t('Edit')}
                          </Button>
                          {channel.revision.status === 'draft' && (
                            <Button
                              size='sm'
                              disabled={submit.isPending}
                              onClick={() => submit.mutate(channel)}
                            >
                              {t('Submit for Review')}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {submit.error instanceof Error && (
              <p role='alert'>{submit.error.message}</p>
            )}
            <div className='flex items-center justify-end gap-3'>
              <Button
                variant='outline'
                disabled={page === 1 || channels.isFetching}
                onClick={() => setPage((value) => value - 1)}
              >
                {t('Previous')}
              </Button>
              <span>{page}</span>
              <Button
                variant='outline'
                disabled={
                  !channels.data ||
                  page * 20 >= channels.data.total ||
                  channels.isFetching
                }
                onClick={() => setPage((value) => value + 1)}
              >
                {t('Next')}
              </Button>
            </div>
          </section>
          <Link
            to='/usage-logs/$section'
            params={{ section: 'common' }}
            className='text-sm underline'
          >
            {t(
              'Usage logs include your requests and requests served by your groups.'
            )}
          </Link>
        </div>
        <Dialog
          open={groupEditor !== null}
          onOpenChange={(open) => {
            if (!open) setGroupEditor(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('Personal Group')}</DialogTitle>
              <DialogDescription>
                {t(
                  'Ratio changes do not require approval. Existing billing rules apply.'
                )}
              </DialogDescription>
            </DialogHeader>
            {groupEditor && (
              <GroupForm
                key={typeof groupEditor === 'string' ? 'new' : groupEditor.id}
                group={
                  typeof groupEditor === 'string' ? undefined : groupEditor
                }
                onSaved={() => setGroupEditor(null)}
              />
            )}
          </DialogContent>
        </Dialog>
        <Dialog
          open={channelEditor !== null}
          onOpenChange={(open) => {
            if (!open) setChannelEditor(null)
          }}
        >
          <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
            <DialogHeader>
              <DialogTitle>{t('Channel Draft')}</DialogTitle>
              <DialogDescription>
                {t('Saving a draft does not change the published channel.')}
              </DialogDescription>
            </DialogHeader>
            {channelEditor && (
              <ChannelForm
                key={
                  typeof channelEditor === 'string'
                    ? 'new'
                    : channelEditor.revision.id
                }
                channel={
                  typeof channelEditor === 'string' ? undefined : channelEditor
                }
                groups={groups.data ?? []}
                onSaved={() => setChannelEditor(null)}
              />
            )}
          </DialogContent>
        </Dialog>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
